import type { PageInfo, Reply, Request } from '@/lib/messaging/types'
import type { DetectedSource, FeatureId, ResearchDepth, ResultDoc, ReviewContext } from '@/lib/types'
import { SAMPLE_DEEP_COMPETITOR, SAMPLE_DEEP_VOICE, SAMPLES } from '@/lib/features/samples'
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
import { sectionsToCopyText } from '@/lib/features/parse'
import { createClaudeClient } from '@/lib/claude/client'
import { config } from '@/lib/config'
import { extractFromPage } from '@/content/extract'
import {
  competitorSections,
  createDefaultOrchestrator,
  customerVoiceSections,
  pmReviewAgentSections,
  reportToSections,
  type AgentContext,
  type AgentResult,
  type BuildDecision,
  type CompetitorPayload,
  type CustomerVoicePayload,
  type PmReviewAgentPayload,
} from '@/lib/agents'
import { parseReadinessReview } from '@/lib/features/pmReview'
import type { ReviewData, ReviewResultDoc } from '@/lib/review'
import { addRunRecord, buildRunRecord } from '@/lib/storage/intelligence'
import {
  buildReviewRecord,
  encodeRaw,
  execFromAgentResult,
  newId,
  stageExec,
  type AgentExecutionRecord,
  type RawOutput,
} from '@/lib/analytics'
import { addReviewRecord } from '@/lib/storage/reviews'

// Open the side panel when the toolbar icon is clicked.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
})
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {})

// Per-service-worker-lifetime session id + extension version, stamped on every
// captured review/feedback record for analytics.
const SESSION_ID = crypto.randomUUID()
function extensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version
  } catch {
    return 'unknown'
  }
}

/** Persist an analytics ReviewRecord (best-effort; fills clientId/session/version). */
async function captureReview(input: {
  reviewId: string
  url?: string
  document: string
  reviewType: 'standard' | 'deep'
  demo: boolean
  model: string
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
  totalLatencyMs: number
  phases?: { extractMs?: number; llmMs?: number; parseMs?: number }
  review?: ReviewData
  agents: AgentExecutionRecord[]
  rawOutputs?: Record<string, RawOutput>
}): Promise<void> {
  try {
    const clientId = await getClientId()
    await addReviewRecord(
      buildReviewRecord({ ...input, clientId, sessionId: SESSION_ID, extensionVersion: extensionVersion() }),
    )
  } catch {
    /* analytics capture is best-effort */
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function errCode(e: unknown): string | undefined {
  return e && typeof e === 'object' && 'code' in e ? (e as { code?: string }).code : undefined
}

const DEPTH_USES: Record<ResearchDepth, number> = { quick: 3, standard: 8, deep: 15 }

// --- Structured review view-model (tabbed results UI) ---

/** Readiness review for a standalone PM Review run; undefined when the model
 *  output didn't parse (UI then falls back to the flat card list). */
function readinessReviewData(rawText: string): ReviewData | undefined {
  try {
    const { review } = parseReadinessReview(rawText)
    const hasContent =
      review.readiness != null ||
      review.critical.length > 0 ||
      review.medium.length > 0 ||
      review.missingRequirements.length > 0
    return hasContent ? { decision: review.decision, readiness: review, deep: false } : undefined
  } catch {
    return undefined
  }
}

function agentData<T>(results: AgentResult[], agentId: string): T | undefined {
  return results.find((r) => r.agentId === agentId && r.status === 'ok')?.data as T | undefined
}

const DEEP_DECISION_LABEL: Record<BuildDecision, string> = {
  build: 'Build',
  build_with_changes: 'Build with Changes',
  validate_first: 'Validate First',
  do_not_build: 'Do Not Build',
}

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
    const review = feature.id === 'pm_review' ? readinessReviewData(sample.text) : undefined
    const result: ReviewResultDoc = {
      feature: feature.id,
      title: `${feature.label} (sample)`,
      sections: parsed.sections,
      sources: sample.sources.length ? sample.sources : undefined,
      copyText: parsed.copyText,
      review,
    }
    if (review) {
      const reviewId = newId('rv')
      review.reviewId = reviewId
      await captureReview({
        reviewId,
        url,
        document: sample.text,
        reviewType: 'standard',
        demo: true,
        model: 'demo',
        totalLatencyMs: 0,
        review,
        agents: [stageExec('pm_review', 'demo')],
        rawOutputs: { pm_review: await encodeRaw(sample.text) },
      })
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

  const extractStart = Date.now()
  const raw = await injectExtract(tabId)
  const extractMs = Date.now() - extractStart
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
  const llmStart = Date.now()
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
  const llmMs = Date.now() - llmStart

  if (gen.usage) {
    console.log('[PM Co-Pilot] token usage', {
      feature: feature.id,
      depth: settings.researchDepth,
      ...gen.usage,
    })
  }

  const parseStart = Date.now()
  let parsed
  try {
    parsed = feature.parse(gen.text, gen.sources)
  } catch {
    return { ok: false, error: 'The model returned an unexpected format. Please try again.' }
  }
  const parseMs = Date.now() - parseStart

  const review = feature.id === 'pm_review' ? readinessReviewData(gen.text) : undefined
  const result: ReviewResultDoc = {
    feature: feature.id,
    title: feature.label,
    sections: parsed.sections,
    sources: gen.sources.length ? gen.sources : undefined,
    copyText: parsed.copyText,
    usage: gen.usage,
    review,
  }

  if (review) {
    const reviewId = newId('rv')
    review.reviewId = reviewId
    await captureReview({
      reviewId,
      url: ctx.url,
      document: ctx.content,
      reviewType: 'standard',
      demo: false,
      model,
      usage: gen.usage,
      totalLatencyMs: extractMs + llmMs + parseMs,
      phases: { extractMs, llmMs, parseMs },
      review,
      agents: [stageExec('pm_review', model, gen.usage, llmMs)],
      rawOutputs: { pm_review: await encodeRaw(gen.text) },
    })
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

// A canned synthesis for demo mode (no API call) — exercises the decision card.
const DEMO_REPORT = {
  executiveSummary:
    'Sample multi-agent synthesis. The feature targets a real workflow, but demand and rollout risk are under-evidenced in the document.',
  recommendation: 'Build a thin slice behind a flag and validate the core assumption before a full rollout.',
  confidence: 0.6,
  supportingEvidence: ['The problem is clearly articulated and ties to a stated business goal.'],
  contradictingEvidence: ['No evidence the problem is frequent enough to prioritize now.'],
  risks: ['Adoption risk: unclear trigger for users to engage.', 'Rollout risk: no staged plan.'],
  openQuestions: ['What is the baseline for the success metric?', 'Which segment feels this most?'],
  suggestedExperiments: ['Ship to 5% and measure activation vs. control over two weeks.'],
  missingRequirements: ['Acceptance criteria', 'Instrumentation / success-metric definition'],
  finalVerdict: 'Promising but unproven — de-risk with a cheap validation before committing.',
  decision: {
    recommendation: 'validate_first' as const,
    confidence: 0.6,
    rationale: [
      'Problem is clear but demand is unproven.',
      'Cheap validation will materially reduce uncertainty.',
    ],
  },
}

async function handleDeepReview(
  tabId: number,
  reviewContext?: ReviewContext,
): Promise<Reply<ResultDoc>> {
  const settings = await getSettings()

  // Demo mode: render the canned report through the real card pipeline, no API call.
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
    await new Promise((r) => setTimeout(r, 700))
    const sections = reportToSections(DEMO_REPORT)
    // Full structured sample (readiness + voice + competitor) so the demo shows
    // the same tabbed review experience a live deep run produces.
    const review: ReviewData = {
      decision: DEEP_DECISION_LABEL[DEMO_REPORT.decision.recommendation],
      readiness: readinessReviewData(SAMPLES.pm_review.text)?.readiness,
      verdict: DEMO_REPORT.finalVerdict,
      voice: SAMPLE_DEEP_VOICE,
      competitor: SAMPLE_DEEP_COMPETITOR,
      insights: SAMPLE_DEEP_COMPETITOR.landscape.whiteSpace
        .slice(0, 4)
        .map((w) => ({ text: w.opportunity, source: w.rationale })),
      deep: true,
    }
    const result: ReviewResultDoc = {
      feature: 'pm_review',
      title: 'Deep Intelligence (sample)',
      sections,
      copyText: sectionsToCopyText('Deep Intelligence', sections),
      review,
    }
    const reviewId = newId('rv')
    review.reviewId = reviewId
    await captureReview({
      reviewId,
      url,
      document: SAMPLES.pm_review.text,
      reviewType: 'deep',
      demo: true,
      model: 'demo',
      totalLatencyMs: 0,
      review,
      agents: ['analyze', 'pm_review', 'customer_voice', 'competitor', 'synthesis'].map((a) =>
        stageExec(a, 'demo'),
      ),
    })
    await addHistory({
      id: newHistoryId(),
      timestamp: Date.now(),
      pageTitle,
      url,
      source,
      feature: 'pm_review',
      mode: settings.mode,
      result,
    })
    return { ok: true, data: result }
  }

  if (!config.hasBackend && !settings.apiKey) {
    return { ok: false, error: 'Add your API key in Settings first.' }
  }

  const extractStart = Date.now()
  const raw = await injectExtract(tabId)
  const extractMs = Date.now() - extractStart
  const source = detectSource(raw.url)
  const ctx = buildPageContext(raw, source, 20_000)
  const userContext = await getUserContext()
  const clientId = await getClientId()

  const agentContext: AgentContext = {
    document: ctx.content,
    industry: userContext.industry || undefined,
    featureName: reviewContext?.featureName || undefined,
    metadata: { userContext, reviewContext, source, clientId },
  }

  const model = settings.model === 'auto' ? 'claude-sonnet-4-6' : settings.model
  const orchestrator = createDefaultOrchestrator({ model, apiKey: settings.apiKey })
  const llmStart = Date.now()
  const out = await orchestrator.run(agentContext)
  const llmMs = Date.now() - llmStart

  if (out.usage) {
    console.log('[PM Co-Pilot] deep review token usage', {
      ran: out.ranAgentIds,
      skipped: out.skippedAgentIds,
      decision: out.report.decision.recommendation,
      ...out.usage,
    })
  }

  // Synthesis decision first, then PRD readiness, then the real customer-evidence
  // + competitor cards (quotes + links). Sections remain the copy/fallback view;
  // the tabbed UI renders from the structured `review` below.
  const sections = [
    ...reportToSections(out.report),
    ...pmReviewAgentSections(out.results),
    ...customerVoiceSections(out.results),
    ...competitorSections(out.results),
  ]
  const pmData = agentData<PmReviewAgentPayload>(out.results, 'pm_review')
  const compData = agentData<CompetitorPayload>(out.results, 'competitor')
  const voiceData = agentData<CustomerVoicePayload>(out.results, 'customer_voice')

  // Capture raw agent outputs BEFORE stripping them from the payloads that ship
  // to the UI (raw is analytics-only — "why was this finding generated?").
  const rawOutputs: Record<string, RawOutput> = { analyze: await encodeRaw(JSON.stringify(out.analysis)) }
  if (pmData?.raw) rawOutputs.pm_review = await encodeRaw(pmData.raw)
  if (voiceData) rawOutputs.customer_voice = await encodeRaw(JSON.stringify(voiceData))
  if (compData?.raw) rawOutputs.competitor = await encodeRaw(compData.raw)
  rawOutputs.synthesis = await encodeRaw(JSON.stringify(out.report))

  const review: ReviewData = {
    decision: DEEP_DECISION_LABEL[out.report.decision.recommendation],
    readiness: pmData?.review,
    verdict: out.report.finalVerdict || out.report.executiveSummary || undefined,
    voice: voiceData,
    // Strip the analytics-only raw text before it ships to the UI/history.
    competitor: compData ? { ...compData, raw: undefined } : undefined,
    insights: compData?.landscape.whiteSpace
      .slice(0, 4)
      .map((w) => ({ text: w.opportunity, source: w.rationale })),
    deep: true,
  }
  const result: ReviewResultDoc = {
    feature: 'pm_review',
    title: 'Deep Intelligence',
    sections,
    copyText: sectionsToCopyText('Deep Intelligence', sections),
    usage: out.usage,
    review,
  }

  const reviewId = newId('rv')
  review.reviewId = reviewId
  const agentExecs: AgentExecutionRecord[] = [
    stageExec('analyze', model, out.analyzeUsage),
    ...out.results.map((r) => execFromAgentResult(r, model)),
    ...out.skippedAgentIds.map((id) => stageExec(id, model, undefined, undefined, 'skipped')),
    stageExec('synthesis', model, out.synthesisUsage),
  ]
  await captureReview({
    reviewId,
    url: ctx.url,
    document: ctx.content,
    reviewType: 'deep',
    demo: false,
    model,
    usage: out.usage,
    totalLatencyMs: extractMs + llmMs,
    phases: { extractMs, llmMs },
    review,
    agents: agentExecs,
    rawOutputs,
  })

  const ts = Date.now()
  // Capture the structured run (foundation for the Intelligence Graph).
  try {
    await addRunRecord(
      buildRunRecord({
        id: newHistoryId(),
        timestamp: ts,
        url: ctx.url,
        source,
        result: out,
      }),
    )
  } catch (e) {
    console.warn('[PM Co-Pilot] run-record capture failed', e)
  }

  await addHistory({
    id: newHistoryId(),
    timestamp: ts,
    pageTitle: ctx.title,
    url: ctx.url,
    source,
    feature: 'pm_review',
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
    case 'RUN_DEEP_REVIEW':
      return handleDeepReview(req.tabId, req.reviewContext)
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
