import type { TokenUsage } from '@/lib/types'
import type { ReviewData } from '@/lib/review'
import type { AgentResult, CustomerVoiceHypothesis } from '@/lib/agents/types'
import { PM_REVIEW_SYSTEM } from '@/lib/features/pmReview'
import { ANALYZE_SYSTEM } from '@/lib/agents/analyzer'
import { SYNTHESIS_SYSTEM } from '@/lib/agents/synthesis'
import { COMPETITOR_SYSTEM } from '@/lib/agents/agents/competitor/discovery'
import { validateSystemPrompt } from '@/lib/agents/agents/customerVoice/validate'

// ---------------------------------------------------------------------------
// Feedback & analytics instrumentation — event-sourced records shaped like
// future DB tables (reviews / agent_executions / findings / feedback_events),
// persisted in chrome.storage.local today so a later sync job can ship them to
// a real backend unchanged. Capture only — no dashboards, charts, or reports.
// ---------------------------------------------------------------------------

export const ANALYTICS_SCHEMA_VERSION = 1 as const

/** Bumped BY HAND when a prompt meaningfully changes; promptHash catches edits
 * that forgot the bump. */
export const PROMPT_VERSIONS: Record<string, string> = {
  analyze: 'analyze_v2_compact_context',
  pm_review: 'pm_review_v3_xml_readiness',
  customer_voice: 'customer_voice_validate_v1',
  competitor: 'competitor_discover_reason_v1',
  synthesis: 'synthesis_v3_signals',
}

// --- ids & hashing ---

/** FNV-1a 32-bit → 8-char hex. Stable, dependency-free, good enough for ids. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/** Titles are identity — normalize so punctuation/case/whitespace edits don't split analytics. */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** fnv1a of the ACTUAL system prompts (canonical form for dynamic ones). */
export const PROMPT_HASHES: Record<string, string> = {
  analyze: fnv1a(ANALYZE_SYSTEM),
  pm_review: fnv1a(PM_REVIEW_SYSTEM),
  customer_voice: fnv1a(validateSystemPrompt('', '')),
  competitor: fnv1a(COMPETITOR_SYSTEM),
  synthesis: fnv1a(SYNTHESIS_SYSTEM),
}

// --- entities ---

export interface FindingTaxonomy {
  domain: string
  subdomain: string
  type: string
}

export interface FindingRecord {
  /** f_<fnv1a(agent|domain|subdomain|type|section|normalizedTitle)> — IDENTITY
   * fields only. recommendation/example/description are stored but NOT hashed:
   * wording evolves, identity shouldn't. */
  findingId: string
  reviewId: string
  agent: string
  /** Source bucket: critical|medium|minor|missing_*|*_question|strength|claim|verdict|recommendation|opportunity */
  category: string
  taxonomy: FindingTaxonomy
  severity?: 'high' | 'medium' | 'low'
  /** 0..1 when the source carries one. */
  confidence?: number
  /** UI section label ("Functional Specs", "Customer Validation", …). */
  section: string
  title: string
  text?: string
  recommendation?: string
  suggestedAddition?: string
  displayOrder: number
}

export interface AgentExecutionRecord {
  agent: string
  model: string
  promptVersion: string
  promptHash: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  latencyMs?: number
  status: 'ok' | 'error' | 'timeout' | 'skipped'
}

export interface RawOutput {
  encoding: 'gzip-base64' | 'plain'
  data: string
}

export interface ReviewRecord {
  schemaVersion: typeof ANALYTICS_SCHEMA_VERSION
  reviewId: string
  timestamp: number
  clientId: string
  sessionId: string
  url?: string
  documentHash: string
  reviewType: 'standard' | 'deep'
  demo: boolean
  extensionVersion: string
  model: string
  promptVersions: Record<string, string>
  promptHashes: Record<string, string>
  totalInputTokens?: number
  totalOutputTokens?: number
  totalTokens?: number
  totalLatencyMs: number
  /** Duration breakdown — answers "where is it slow?". */
  phases?: { extractMs?: number; llmMs?: number; parseMs?: number }
  readinessScore?: number
  decision?: string
  agents: AgentExecutionRecord[]
  findings: FindingRecord[]
  /** Per-agent raw model output ("why was this finding generated?"). Pruned
   * beyond the newest reviews by the store to respect the storage quota. */
  rawOutputs?: Record<string, RawOutput>
}

export type InteractionAction =
  | 'thumbs_up'
  | 'thumbs_down'
  // Reserved for later implicit-signal capture — same store, no schema change:
  | 'expand'
  | 'collapse'
  | 'copy'
  | 'dismiss'
  | 'export'

export interface FeedbackEvent {
  schemaVersion: typeof ANALYTICS_SCHEMA_VERSION
  feedbackId: string
  /** Optional so future session-level events (export, close) fit the same store. */
  findingId?: string
  reviewId: string
  timestamp: number
  action: InteractionAction
  agent: string
  extensionVersion: string
  clientId?: string
  sessionId?: string
  url?: string
}

/**
 * ReviewSession — DESIGNED, NOT PERSISTED. Sessions reconstruct by joining
 * pm_reviews + pm_feedback_events on sessionId ordered by timestamp
 * (run → open tab → thumbs → expand → close). When session analytics are
 * wanted, only a materializer is added — no new capture, no migration.
 */
export interface ReviewSessionView {
  sessionId: string
  clientId?: string
  startedAt: number
  endedAt: number
  reviewIds: string[]
  events: FeedbackEvent[]
}

// --- finding identity + taxonomy ---

const FR = 'Functional Requirements'

/** category → { taxonomy, section }. Open strings — extend freely, no enums. */
const CATEGORY_MAP: Record<string, { taxonomy: FindingTaxonomy; section: string }> = {
  critical: { taxonomy: { domain: FR, subdomain: 'Specification', type: 'Undefined Behaviour' }, section: 'Functional Specs' },
  medium: { taxonomy: { domain: FR, subdomain: 'Specification', type: 'Undefined Behaviour' }, section: 'Functional Specs' },
  minor: { taxonomy: { domain: FR, subdomain: 'Specification', type: 'Improvement' }, section: 'Functional Specs' },
  missing_requirement: { taxonomy: { domain: FR, subdomain: 'Requirements', type: 'Missing Requirement' }, section: 'Functional Specs' },
  missing_user_flow: { taxonomy: { domain: FR, subdomain: 'User Flow', type: 'Missing Requirement' }, section: 'Functional Specs' },
  missing_edge_case: { taxonomy: { domain: FR, subdomain: 'Edge Cases', type: 'Missing Edge Case' }, section: 'Functional Specs' },
  missing_acceptance_criteria: { taxonomy: { domain: FR, subdomain: 'Acceptance Criteria', type: 'Missing Requirement' }, section: 'Functional Specs' },
  missing_nfr: { taxonomy: { domain: 'Non-Functional Requirements', subdomain: 'Non-Functional', type: 'Missing Requirement' }, section: 'Non-Functional Specs' },
  product_question: { taxonomy: { domain: 'Product Strategy', subdomain: 'Clarification', type: 'Open Question' }, section: 'Functional Specs' },
  engineering_question: { taxonomy: { domain: FR, subdomain: 'Clarification', type: 'Open Question' }, section: 'Functional Specs' },
  strength: { taxonomy: { domain: FR, subdomain: 'Specification', type: 'Strength' }, section: 'Implementation Strengths' },
  claim: { taxonomy: { domain: 'Customer Voice', subdomain: 'Claim', type: 'Claim' }, section: 'Customer Validation' },
  verdict: { taxonomy: { domain: 'Customer Voice', subdomain: 'Summary', type: 'Assessment' }, section: 'Customer Validation' },
  recommendation: { taxonomy: { domain: 'Competitor', subdomain: 'Differentiation', type: 'Assessment' }, section: 'Competitor Landscape' },
  opportunity: { taxonomy: { domain: 'Competitor', subdomain: 'Market Gap', type: 'Opportunity' }, section: 'Strategic White Space' },
  insight: { taxonomy: { domain: 'Product Strategy', subdomain: 'Market Gap', type: 'Opportunity' }, section: 'Product Opportunities' },
}

export interface FindingSource {
  agent: string
  category: string
  title: string
  /** Overrides for dynamic taxonomy (e.g. claim hypothesis-category / verdict type). */
  subdomain?: string
  type?: string
}

export function resolveTaxonomy(src: FindingSource): { taxonomy: FindingTaxonomy; section: string } {
  const base = CATEGORY_MAP[src.category] ?? {
    taxonomy: { domain: 'Other', subdomain: src.category, type: 'Finding' },
    section: 'Review',
  }
  return {
    taxonomy: {
      domain: base.taxonomy.domain,
      subdomain: src.subdomain ?? base.taxonomy.subdomain,
      type: src.type ?? base.taxonomy.type,
    },
    section: base.section,
  }
}

/** The shared deterministic id — computed identically by the SW record builder
 * and the UI Thumbs, so feedback joins findings without any plumbing. */
export function findingIdFor(src: FindingSource): string {
  const { taxonomy, section } = resolveTaxonomy(src)
  return `f_${fnv1a(
    [src.agent, taxonomy.domain, taxonomy.subdomain, taxonomy.type, section, normalizeTitle(src.title)].join('|'),
  )}`
}

const VERDICT_TYPE: Record<CustomerVoiceHypothesis['verdict'], string> = {
  supported: 'Supported Claim',
  mixed: 'Mixed Evidence',
  contradicted: 'Contradicted Claim',
  insufficient_evidence: 'Weak Evidence',
}

/** Finding source for a customer-voice claim (verdict shapes the taxonomy type). */
export function claimSource(h: CustomerVoiceHypothesis): FindingSource {
  return {
    agent: 'customer_voice',
    category: 'claim',
    title: h.statement,
    subdomain: h.category,
    type: VERDICT_TYPE[h.verdict] ?? 'Claim',
  }
}

// --- record builders (pure) ---

const SEVERITY_BY_CATEGORY: Record<string, 'high' | 'medium' | 'low'> = {
  critical: 'high',
  medium: 'medium',
  minor: 'low',
}
const CONF_NUM: Record<string, number> = { High: 0.9, Medium: 0.6, Low: 0.3 }

/** Flatten a ReviewData into finding records, in UI display order. Dedupes
 * identical findingIds keeping the first (identical content = same finding). */
export function buildFindingRecords(reviewId: string, review: ReviewData): FindingRecord[] {
  const out: FindingRecord[] = []
  const seen = new Set<string>()
  let order = 0

  const push = (src: FindingSource, extra: Partial<FindingRecord> = {}) => {
    if (!src.title?.trim()) return
    const findingId = findingIdFor(src)
    if (seen.has(findingId)) return
    seen.add(findingId)
    const { taxonomy, section } = resolveTaxonomy(src)
    out.push({
      findingId,
      reviewId,
      agent: src.agent,
      category: src.category,
      taxonomy,
      section,
      title: src.title,
      displayOrder: order++,
      ...extra,
    })
  }

  const r = review.readiness
  if (r) {
    const issues = [
      ...r.critical.map((i) => ({ i, category: 'critical' })),
      ...r.medium.map((i) => ({ i, category: 'medium' })),
      ...r.minor.map((i) => ({ i, category: 'minor' })),
    ]
    for (const { i, category } of issues) {
      push(
        { agent: 'pm_review', category, title: i.title },
        {
          severity: SEVERITY_BY_CATEGORY[category],
          confidence: i.confidence ? CONF_NUM[i.confidence] : undefined,
          text: i.why,
          recommendation: i.fix,
          suggestedAddition: i.example,
        },
      )
    }
    const lists: Array<[string, string[]]> = [
      ['missing_requirement', r.missingRequirements],
      ['missing_user_flow', r.missingUserFlows],
      ['missing_edge_case', r.missingEdgeCases],
      ['missing_acceptance_criteria', r.missingAcceptanceCriteria],
      ['missing_nfr', r.missingNfrs],
      ['product_question', r.productQuestions],
      ['engineering_question', r.engineeringQuestions],
      ['strength', r.strengths],
    ]
    for (const [category, items] of lists) {
      for (const t of items) push({ agent: 'pm_review', category, title: t }, { severity: category.startsWith('missing') ? 'medium' : undefined })
    }
  }

  if (review.verdict) {
    push({ agent: 'customer_voice', category: 'verdict', title: 'Final Verdict' }, { text: review.verdict })
  }
  for (const h of review.voice?.hypotheses ?? []) {
    push(claimSource(h), { confidence: h.confidence / 100, text: h.statement })
  }

  if (review.competitor?.recommendation) {
    push(
      { agent: 'competitor', category: 'recommendation', title: 'Strategy Recommendation' },
      { text: review.competitor.recommendation },
    )
  }
  for (const w of review.competitor?.landscape.whiteSpace ?? []) {
    push({ agent: 'competitor', category: 'opportunity', title: w.opportunity }, { text: w.rationale })
  }
  for (const ins of review.insights ?? []) {
    push({ agent: 'competitor', category: 'insight', title: ins.text }, { text: ins.source })
  }

  return out
}

/** Agent execution record from an orchestrated AgentResult. */
export function execFromAgentResult(r: AgentResult, model: string): AgentExecutionRecord {
  return {
    agent: r.agentId,
    model,
    promptVersion: PROMPT_VERSIONS[r.agentId] ?? 'unknown',
    promptHash: PROMPT_HASHES[r.agentId] ?? '',
    inputTokens: r.usage?.inputTokens,
    outputTokens: r.usage?.outputTokens,
    totalTokens: r.usage?.totalTokens,
    latencyMs: r.durationMs,
    status: r.status === 'ok' || r.status === 'error' || r.status === 'timeout' ? r.status : 'ok',
  }
}

/** Agent execution record for a pipeline stage (analyze/synthesis/standalone call). */
export function stageExec(
  agent: string,
  model: string,
  usage?: TokenUsage,
  latencyMs?: number,
  status: AgentExecutionRecord['status'] = 'ok',
): AgentExecutionRecord {
  return {
    agent,
    model,
    promptVersion: PROMPT_VERSIONS[agent] ?? 'unknown',
    promptHash: PROMPT_HASHES[agent] ?? '',
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    totalTokens: usage?.totalTokens,
    latencyMs,
    status,
  }
}

export interface ReviewCaptureInput {
  reviewId: string
  url?: string
  /** The reviewed document text (hashed, never stored). */
  document: string
  reviewType: 'standard' | 'deep'
  demo: boolean
  clientId: string
  sessionId: string
  extensionVersion: string
  model: string
  totalLatencyMs: number
  phases?: ReviewRecord['phases']
  usage?: TokenUsage
  review?: ReviewData
  agents: AgentExecutionRecord[]
  rawOutputs?: Record<string, RawOutput>
}

export function buildReviewRecord(input: ReviewCaptureInput): ReviewRecord {
  return {
    schemaVersion: ANALYTICS_SCHEMA_VERSION,
    reviewId: input.reviewId,
    timestamp: Date.now(),
    clientId: input.clientId,
    sessionId: input.sessionId,
    url: input.url,
    documentHash: fnv1a(input.document),
    reviewType: input.reviewType,
    demo: input.demo,
    extensionVersion: input.extensionVersion,
    model: input.model,
    promptVersions: { ...PROMPT_VERSIONS },
    promptHashes: { ...PROMPT_HASHES },
    totalInputTokens: input.usage?.inputTokens,
    totalOutputTokens: input.usage?.outputTokens,
    totalTokens: input.usage?.totalTokens,
    totalLatencyMs: input.totalLatencyMs,
    phases: input.phases,
    readinessScore: input.review?.readiness?.readiness,
    decision: input.review?.decision,
    agents: input.agents,
    findings: input.review ? buildFindingRecords(input.reviewId, input.review) : [],
    rawOutputs: input.rawOutputs,
  }
}

// --- raw output encoding ---

const RAW_INPUT_CAP = 60_000
const RAW_PLAIN_CAP = 20_000

/** Gzip+base64 the raw model output (CompressionStream is available in MV3
 * service workers); truncated plain-text fallback elsewhere. */
export async function encodeRaw(text: string): Promise<RawOutput> {
  const t = text.slice(0, RAW_INPUT_CAP)
  try {
    if (typeof CompressionStream === 'undefined') throw new Error('no CompressionStream')
    const stream = new Blob([t]).stream().pipeThrough(new CompressionStream('gzip'))
    const buf = await new Response(stream).arrayBuffer()
    const bytes = new Uint8Array(buf)
    let bin = ''
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    return { encoding: 'gzip-base64', data: btoa(bin) }
  } catch {
    return { encoding: 'plain', data: t.slice(0, RAW_PLAIN_CAP) }
  }
}
