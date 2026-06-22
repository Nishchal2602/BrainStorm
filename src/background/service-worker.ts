import type { PageInfo, Reply, Request } from '@/lib/messaging/types'
import type { DetectedSource, FeatureId, ResearchDepth, ResultDoc, ReviewContext } from '@/lib/types'
import { SAMPLES } from '@/lib/features/samples'
import { getSettings } from '@/lib/storage/settings'
import { getUserContext } from '@/lib/storage/profile'
import { buildContextBlock } from '@/lib/context/contextBlock'
import { addHistory, newHistoryId } from '@/lib/storage/history'
import { getClientId } from '@/lib/storage/client'
import { detectSource } from '@/lib/context/sourceDetect'
import { sourceTemplate } from '@/lib/context/templates'
import { modePersona } from '@/lib/modes/personas'
import { buildPageContext, contextToPromptBlock, type RawExtract } from '@/lib/context/pageContext'
import { getFeature } from '@/lib/features/registry'
import { createClaudeClient } from '@/lib/claude/client'
import { config } from '@/lib/config'
import { extractFromPage } from '@/content/extract'

// Open the side panel when the toolbar icon is clicked.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
})
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {})

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function errCode(e: unknown): string | undefined {
  return e && typeof e === 'object' && 'code' in e ? (e as { code?: string }).code : undefined
}

const DEPTH_USES: Record<ResearchDepth, number> = { quick: 3, standard: 8, deep: 15 }

const CANNOT_READ =
  "Can't read this page. Open PM Co-Pilot via its toolbar icon on a normal web page (not a Chrome settings or extension page), then try again."

async function injectGetPageInfo(tabId: number): Promise<{ url: string; title: string }> {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({ url: location.href, title: document.title }),
    })
    return res.result as { url: string; title: string }
  } catch {
    throw new Error(CANNOT_READ)
  }
}

async function injectExtract(tabId: number): Promise<RawExtract> {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: extractFromPage })
    return res.result as RawExtract
  } catch {
    throw new Error(CANNOT_READ)
  }
}

async function handleGetPageInfo(tabId: number): Promise<Reply<PageInfo>> {
  const { url, title } = await injectGetPageInfo(tabId)
  return { ok: true, data: { url, title, source: detectSource(url) } }
}

async function handleValidateKey(apiKey: string): Promise<Reply<{ valid: true }>> {
  // Route through the same selector the live call uses, so a key validates against
  // the exact provider it will run against (Gemini "AIza…" vs Anthropic "sk-ant-…").
  await createClaudeClient('claude-sonnet-4-6', apiKey).validate()
  return { ok: true, data: { valid: true } }
}

async function handleRunFeature(
  tabId: number,
  featureId: FeatureId,
  reviewContext?: ReviewContext,
): Promise<Reply<ResultDoc>> {
  const settings = await getSettings()
  const feature = getFeature(featureId)
  if (!feature) return { ok: false, error: `Unknown feature: ${featureId}` }

  // Demo mode: return a realistic sample through the real parser — no API call.
  if (settings.demoMode || config.demoMode) {
    let pageTitle = 'Sample page'
    let url = ''
    let source: DetectedSource = 'generic'
    try {
      const info = await injectGetPageInfo(tabId)
      url = info.url
      pageTitle = info.title || pageTitle
      source = detectSource(url)
    } catch {
      /* restricted page — still return the sample */
    }
    await new Promise((r) => setTimeout(r, 600)) // let the loading state show
    const sample = SAMPLES[featureId]
    const parsed = feature.parse(sample.text, sample.sources)
    const result: ResultDoc = {
      feature: feature.id,
      title: `${feature.label} (sample)`,
      sections: parsed.sections,
      sources: sample.sources.length ? sample.sources : undefined,
      copyText: parsed.copyText,
    }
    await addHistory({
      id: newHistoryId(),
      timestamp: Date.now(),
      pageTitle,
      url,
      source,
      feature: feature.id,
      mode: settings.mode,
      result,
    })
    return { ok: true, data: result }
  }

  // Gemini or proxy (owner-key) mode needs no user key; only the BYOK fallback does.
  if (!config.hasBackend && !settings.apiKey) {
    return { ok: false, error: 'Add your API key in Settings first.' }
  }

  const raw = await injectExtract(tabId)
  const ctx = buildPageContext(raw, detectSource(raw.url), feature.maxPageChars(settings.researchDepth))

  const system = [
    modePersona(settings.mode),
    sourceTemplate(ctx.source),
    feature.systemInstructions,
  ].join('\n\n')
  const pageText = contextToPromptBlock(ctx)
  const taskText = feature.buildTask(ctx)

  // User profile + per-review context, injected BEFORE the document.
  const userContext = await getUserContext()
  const contextBlock = buildContextBlock(userContext, reviewContext) || undefined

  const model = settings.model === 'auto' ? feature.model : settings.model
  const client = createClaudeClient(model, settings.apiKey)
  const clientId = await getClientId()
  const gen = await client.generate({
    system,
    pageText,
    taskText,
    contextBlock,
    maxTokens: feature.maxTokens(settings.researchDepth),
    jsonSchema: feature.output === 'structured' ? feature.jsonSchema : undefined,
    webSearch: feature.webSearch ? { maxUses: DEPTH_USES[settings.researchDepth] } : undefined,
    // Caching only pays off for PM Review (web_search pause_turn continuations).
    cache: feature.webSearch === true,
    // Per-user rate-limit metadata (proxy enforces caps per client + depth).
    meta: { clientId, depth: settings.researchDepth },
  })

  if (gen.usage) {
    console.log('[PM Co-Pilot] token usage', {
      feature: feature.id,
      depth: settings.researchDepth,
      ...gen.usage,
    })
  }

  let parsed
  try {
    parsed = feature.parse(gen.text, gen.sources)
  } catch {
    return { ok: false, error: 'The model returned an unexpected format. Please try again.' }
  }

  const result: ResultDoc = {
    feature: feature.id,
    title: feature.label,
    sections: parsed.sections,
    sources: gen.sources.length ? gen.sources : undefined,
    copyText: parsed.copyText,
    usage: gen.usage,
  }

  await addHistory({
    id: newHistoryId(),
    timestamp: Date.now(),
    pageTitle: ctx.title,
    url: ctx.url,
    source: ctx.source,
    feature: feature.id,
    mode: settings.mode,
    result,
  })

  return { ok: true, data: result }
}

async function dispatch(req: Request): Promise<Reply<unknown>> {
  switch (req.type) {
    case 'GET_PAGE_INFO':
      return handleGetPageInfo(req.tabId)
    case 'RUN_FEATURE':
      return handleRunFeature(req.tabId, req.featureId, req.reviewContext)
    case 'VALIDATE_KEY':
      return handleValidateKey(req.apiKey)
    default:
      return { ok: false, error: 'Unknown request.' }
  }
}

chrome.runtime.onMessage.addListener((msg: Request, _sender, sendResponse) => {
  dispatch(msg)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: errMsg(e), code: errCode(e) }))
  return true // keep the channel open for the async response
})
