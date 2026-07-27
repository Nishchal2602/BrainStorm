import type { ApplyPatchRequest, GeneratePatchRequest, PageInfo, Reply, Request } from '@/lib/messaging/types'
import type { DetectedSource, FeatureId, ResearchDepth, ResultDoc, ReviewContext } from '@/lib/types'
import { SAMPLE_DEEP_COMPETITOR, SAMPLE_DEEP_VOICE, SAMPLE_RETRY_PATCH, SAMPLES } from '@/lib/features/samples'
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
import { locateAndHighlight } from '@/content/locate'
import { matchHeading, sameDoc, STRICT_MATCH, type ResolvedTarget } from '@/lib/navigation'
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
import {
  bucketIssues,
  buildGroundedPatchPrompt,
  buildPatchPrompt,
  buildRepairPrompt,
  collectPatchStats,
  ISSUE_BUCKETS,
  parseGroundedPatch,
  parseReadinessReview,
  parseSinglePatch,
  patchTargetValid,
  REVIEW_PAGE_CHARS,
  validatePatches,
  type ReadinessReview,
  type SuggestedPatch,
} from '@/lib/features/pmReview'
import { buildSectionView } from '@/lib/sectionView'
import { detectedPackIds, detectObligations } from '@/lib/obligations/detect'
import { renderCoverageChecklist } from '@/lib/obligations/render'
import { validateDraft, violationCodes } from '@/lib/draftValidators'
import { anchorPatch, anchorPatches } from '@/lib/editor/anchor'
import { getEditor } from '@/lib/editor/registry'
import type { ApplyResult } from '@/lib/editor/types'
import { getNotionAuth, setNotionAuth } from '@/lib/storage/notionAuth'
import type { ReviewData, ReviewResultDoc } from '@/lib/review'
import { addRunRecord, buildRunRecord } from '@/lib/storage/intelligence'
import {
  buildReviewRecord,
  encodeRaw,
  execFromAgentResult,
  findingIdFor,
  newId,
  stageExec,
  type AgentExecutionRecord,
  type RawOutput,
} from '@/lib/analytics'
import { addReviewRecord } from '@/lib/storage/reviews'
import { recordPatchEvent } from '@/lib/storage/patchEvents'

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
    // Any bucket counts — a review that found only technical or compliance issues
    // is still a structured review, and must not fall back to flat cards.
    const hasContent =
      review.readiness != null ||
      ISSUE_BUCKETS.some((b) => bucketIssues(review, b).length > 0) ||
      review.missingRequirements.length > 0
    return hasContent ? { decision: review.decision, readiness: review, deep: false } : undefined
  } catch {
    return undefined
  }
}

function agentData<T>(results: AgentResult[], agentId: string): T | undefined {
  return results.find((r) => r.agentId === agentId && r.status === 'ok')?.data as T | undefined
}

/**
 * Post-parse patch pass: drop patches whose targetHeading isn't a real outline
 * heading (a hallucinated heading would mis-place a Phase-2 apply), then log
 * METADATA only — ids/kinds/headings/lengths, never patch or PRD content.
 */
function finalizePatches(
  readiness: ReadinessReview | undefined,
  headings: Array<{ text: string }> | undefined,
  generationMs?: number,
): void {
  if (!readiness) return
  // Non-destructive: unverified headings are logged, not dropped (Apply is disabled).
  const unverifiedTargets = validatePatches(readiness, (headings ?? []).map((h) => h.text))
  const stats = collectPatchStats(readiness)
  console.log('[PM Co-Pilot] patches generated', {
    count: stats.count,
    unverifiedTargets,
    generationMs,
    patches: stats.patches,
  })
}

/** One 'generated' lifecycle event per surviving patch (the funnel's entry point). */
async function recordGeneratedPatches(reviewId: string, readiness?: ReadinessReview): Promise<void> {
  if (!readiness) return
  // Derived from ISSUE_BUCKETS — a bucket missed here loses its funnel entry point.
  for (const bucket of ISSUE_BUCKETS) {
    const category = bucket.category
    for (const issue of bucketIssues(readiness, bucket)) {
      const p = issue.suggestedPatch
      if (!p) continue
      await recordPatchEvent({
        type: 'generated',
        reviewId,
        patchId: p.id,
        findingId: findingIdFor({ agent: 'pm_review', category, title: issue.title }),
        length: p.content.length,
      })
    }
  }
}

const DEEP_DECISION_LABEL: Record<BuildDecision, string> = {
  build: 'Build',
  build_with_changes: 'Build with Changes',
  validate_first: 'Validate First',
  do_not_build: 'Do Not Build',
}

const CANNOT_READ =
  "Can't read this page. Open Pocket PM via its toolbar icon on a normal web page (not a Chrome settings or extension page), then try again."

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

/** Jump-to-PRD: run the locator in the tab; { found:false } = section missing. */
async function handleJumpToReference(
  tabId: number,
  target: ResolvedTarget,
): Promise<Reply<{ found: boolean }>> {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: locateAndHighlight,
      args: [target],
    })
    return { ok: true, data: (res.result as { found: boolean } | undefined) ?? { found: false } }
  } catch {
    // Restricted page / tab gone — the panel maps this to the "open the PRD" toast.
    return { ok: false, error: CANNOT_READ, code: 'CANNOT_READ' }
  }
}

async function handleValidateKey(apiKey: string): Promise<Reply<{ valid: true }>> {
  // Route through the same selector the live call uses, so a key validates against
  // the exact provider it will run against (Gemini "AIza…" vs Anthropic "sk-ant-…").
  await createClaudeClient('claude-sonnet-4-6', apiKey).validate()
  return { ok: true, data: { valid: true } }
}

/**
 * Regenerate ONE issue's AI Draft (the Retry button) without rerunning the
 * whole review — the issue is already known; only the patch text is produced.
 */
async function handleGeneratePatch(req: GeneratePatchRequest): Promise<Reply<{ patch: SuggestedPatch }>> {
  const settings = await getSettings()

  // Demo mode: canned patch so the Retry flow works without a key.
  if (settings.demoMode || config.demoMode) {
    await new Promise((r) => setTimeout(r, 400))
    return { ok: true, data: { patch: { ...SAMPLE_RETRY_PATCH, id: req.patchId } } }
  }

  if (!config.hasBackend && !settings.apiKey) {
    return { ok: false, error: 'Add your API key in Settings first.' }
  }

  const raw = await injectExtract(req.tabId)
  // The patch must be generated from the document the review actually ran on.
  if (req.reviewUrl && !sameDoc(raw.url, req.reviewUrl)) {
    return {
      ok: false,
      error: 'Open the reviewed document in this tab, then retry.',
      code: 'WRONG_DOC',
    }
  }
  // Same budget as the review's standard depth — a Retry must be able to find the
  // section it is regenerating, and this used to be an independent hardcoded 14k.
  const ctx = buildPageContext(raw, detectSource(raw.url), REVIEW_PAGE_CHARS.standard)
  const headings = ctx.headings ?? []
  const outline = headings.map((h) => h.text)

  // Ground the generation: resolve the issue's location FIRST, then show the model
  // that section's REAL content — line-numbered, with block types — so it can
  // extend what is there instead of guessing. It still never picks a heading
  // (Phase-3 safety). Falls back to the outline prompt only when `where` can't be
  // resolved (that patch comes back unanchored → Apply disabled, Copy still works).
  const groundedIdx =
    // STRICT: the resolved section is what we SHOW the model as ground truth —
    // grounding it on the wrong section is worse than not grounding at all.
    req.issue.where && headings.length ? matchHeading(req.issue.where, outline, STRICT_MATCH) : null
  const view = groundedIdx !== null ? buildSectionView(ctx.content, headings, groundedIdx) : undefined
  const grounded = view !== undefined
  const prompt = view
    ? buildGroundedPatchPrompt(req.issue, view)
    : buildPatchPrompt(req.issue, outline, ctx.content)

  const model = settings.model === 'auto' ? 'claude-sonnet-4-6' : settings.model
  const client = createClaudeClient(model, settings.apiKey)
  const clientId = await getClientId()
  const startedAt = Date.now()

  const headingText = groundedIdx !== null ? headings[groundedIdx].text : ''
  const run = async (p: { system: string; pageText: string; taskText: string }) => {
    const gen = await client.generate({
      system: p.system,
      pageText: p.pageText,
      taskText: p.taskText,
      maxTokens: 1500,
      meta: { clientId, depth: settings.researchDepth },
    })
    return view
      ? parseGroundedPatch(gen.text, req.patchId, headingText)
      : parseSinglePatch(gen.text, req.patchId)
  }

  let patch = await run(prompt)
  if (!patch) {
    return { ok: false, error: 'The model did not return a usable patch. Try again.' }
  }

  // Deterministic self-review. These rules enforce what PATCH_RULES already asks
  // for; instructions alone don't hold, and a model grading its own prose costs
  // twice as much for a worse signal.
  let check = validateDraft(patch.content, view)
  let repaired = false
  if (!check.ok && view) {
    // ONE bounded repair pass, naming the exact violations.
    const retryPatch = await run(buildRepairPrompt(patch.content, check.violations, view))
    if (retryPatch) {
      const recheck = validateDraft(retryPatch.content, view)
      // Keep the repair only if it actually improved things.
      if (recheck.violations.length < check.violations.length) {
        patch = retryPatch
        check = recheck
        repaired = true
      }
    }
  }
  const generationMs = Date.now() - startedAt

  // Anchor the fresh patch locally so Apply is enabled (never model-decided).
  await anchorPatch(patch, ctx.content, headings)
  // Non-fatal: an unverified heading is fine while Apply is disabled — keep the draft.
  // Metadata only — never patch or PRD content (violation CODES, not messages).
  console.log('[PM Co-Pilot] draft generated', {
    patchId: patch.id,
    kind: patch.kind,
    targetHeading: patch.targetHeading,
    grounded,
    sectionLines: view?.lines.length,
    sectionHasList: view?.hasList,
    repaired,
    violations: violationCodes(check.violations),
    anchored: patch.anchor != null,
    targetVerified: patchTargetValid(patch.targetHeading, outline),
    length: patch.content.length,
    generationMs,
  })
  return { ok: true, data: { patch } }
}

const APPLY_ERRORS: Record<string, string> = {
  WRONG_DOC: 'Open the reviewed Notion page in this tab, then apply.',
  UNSUPPORTED_SITE: 'Direct editing is not supported on this site yet.',
}

/**
 * Apply ONE (possibly user-edited) AI Draft to the live document via the DOM.
 * Same same-doc guard as handleGeneratePatch; the editor owns the DOM mutation.
 * Logs METADATA only — never the body/PRD text.
 */
async function handleApplyPatch(req: ApplyPatchRequest): Promise<Reply<ApplyResult>> {
  const startedAt = Date.now()
  const { url } = await injectGetPageInfo(req.tabId)
  if (req.reviewUrl && !sameDoc(url, req.reviewUrl)) {
    return { ok: false, error: APPLY_ERRORS.WRONG_DOC, code: 'WRONG_DOC' }
  }
  const auth = await getNotionAuth()
  if (!auth) {
    return { ok: false, error: 'Connect Notion in Settings to apply.', code: 'NOT_CONNECTED' }
  }
  const editor = getEditor(url, auth.accessToken)
  if (!editor) {
    return { ok: false, error: APPLY_ERRORS.UNSUPPORTED_SITE, code: 'UNSUPPORTED_SITE' }
  }
  const result = await editor.applyPatch({
    tabId: req.tabId,
    url,
    token: auth.accessToken,
    action: req.action,
    anchor: req.anchor,
    body: req.body,
  })
  let hostname = ''
  try {
    hostname = new URL(url).hostname
  } catch {
    /* ignore */
  }
  console.log('[PM Co-Pilot] patch apply', {
    targetHeading: req.anchor.headingText,
    hostname,
    success: result.success,
    code: result.code,
    insertedBlocks: result.insertedBlocks,
    durationMs: Date.now() - startedAt,
  })
  return { ok: true, data: result }
}

/** Exchange a Notion OAuth code for a token via the Worker proxy (holds the secret), then persist it. */
async function handleExchangeNotionCode(
  code: string,
  redirectUri: string,
): Promise<Reply<{ workspaceName?: string }>> {
  if (!config.notionOauthUrl) {
    return { ok: false, error: 'Notion connection is not configured in this build.' }
  }
  let res: Response
  try {
    res = await fetch(config.notionOauthUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, redirectUri }),
    })
  } catch {
    return { ok: false, error: 'Could not reach the connection service. Try again.' }
  }
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string
    workspace_id?: string
    workspace_name?: string
    workspace_icon?: string
    bot_id?: string
    error?: string
  }
  if (!res.ok || !data.access_token) {
    return { ok: false, error: data.error || 'Notion rejected the connection. Try again.' }
  }
  await setNotionAuth({
    accessToken: data.access_token,
    workspaceId: data.workspace_id,
    workspaceName: data.workspace_name,
    workspaceIcon: data.workspace_icon,
    botId: data.bot_id,
    connectedAt: Date.now(),
  })
  return { ok: true, data: { workspaceName: data.workspace_name } }
}

async function handleNotionStatus(): Promise<Reply<{ connected: boolean; workspaceName?: string }>> {
  const auth = await getNotionAuth()
  return { ok: true, data: { connected: !!auth, workspaceName: auth?.workspaceName } }
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
      await recordGeneratedPatches(reviewId, review.readiness)
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

  // User profile + per-review context, injected BEFORE the document.
  const userContext = await getUserContext()
  const contextBlock = buildContextBlock(userContext, reviewContext) || undefined

  // Coverage checklist (Phase 7). Detection runs on raw.content — the FULL
  // untruncated document — so an attribute stated in a part the model won't see
  // still counts as specified. If the document is STILL truncated at this budget we
  // suppress the checklist entirely rather than ask closed questions about text
  // nobody can read: a fabricated "missing requirement" costs more trust than a
  // missed one.
  let coverage = ''
  if (feature.id === 'pm_review' && !ctx.truncated) {
    const gaps = detectObligations(raw.content, ctx.headings, { industry: userContext.industry })
    coverage = renderCoverageChecklist(gaps)
    console.log('[PM Co-Pilot] coverage scan', {
      packs: detectedPackIds(raw.content, { industry: userContext.industry }),
      gaps: gaps.length,
      obligations: gaps.map((g) => g.obligation.id),
    })
  }
  const taskText = coverage ? `${coverage}\n\n${feature.buildTask(ctx)}` : feature.buildTask(ctx)

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
  // Document map for jump-to-PRD navigation (live runs only — headings were
  // captured from the real page during extraction).
  if (review && ctx.headings?.length) review.docMap = { url: ctx.url, headings: ctx.headings }
  // Anchor patches locally (Apply targets), then validate + log BEFORE capture
  // so analytics only sees survivors.
  if (review?.readiness) await anchorPatches(review.readiness, { content: ctx.content, headings: ctx.headings })
  finalizePatches(review?.readiness, ctx.headings, llmMs)
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
    await recordGeneratedPatches(reviewId, review.readiness)
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
    await recordGeneratedPatches(reviewId, review.readiness)
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
  const ctx = buildPageContext(raw, source, REVIEW_PAGE_CHARS.deep)
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
    docMap: ctx.headings?.length ? { url: ctx.url, headings: ctx.headings } : undefined,
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
  // Anchor patches locally (Apply targets), then validate + log BEFORE capture
  // so analytics only sees survivors.
  if (review.readiness) await anchorPatches(review.readiness, { content: ctx.content, headings: ctx.headings })
  finalizePatches(review.readiness, ctx.headings, llmMs)
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
  await recordGeneratedPatches(reviewId, review.readiness)

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
    case 'JUMP_TO_REFERENCE':
      return handleJumpToReference(req.tabId, req.target)
    case 'APPLY_PATCH':
      return handleApplyPatch(req)
    case 'GENERATE_PATCH':
      return handleGeneratePatch(req)
    case 'EXCHANGE_NOTION_CODE':
      return handleExchangeNotionCode(req.code, req.redirectUri)
    case 'NOTION_STATUS':
      return handleNotionStatus()
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
