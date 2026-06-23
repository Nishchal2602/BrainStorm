import type { ReviewContext, TokenUsage, UserContext } from '@/lib/types'

// --- Shared context (the V2 spec's "ReviewContext", renamed to avoid colliding
// with the existing per-review ReviewContext in @/lib/types). Every agent gets it. ---
export interface AgentContext {
  /** The PRD / document under review (Markdown). Required. */
  document: string
  productName?: string
  industry?: string
  country?: string
  featureName?: string
  productType?: string
  /** Free-form extras: { userContext, reviewContext, source, classification, signal }. */
  metadata?: Record<string, unknown>
}

export type RegulatorySensitivity = 'none' | 'low' | 'medium' | 'high'

/**
 * Output of the orchestrator's Step 1 — one structured call that both classifies
 * the document AND extracts the real underlying problem + a search plan. Shared
 * across agents (Customer Voice now; Competitor/Compliance later) so the document
 * is analyzed only once.
 */
export interface DocumentAnalysis {
  // Classification
  industry: string
  productCategory: string
  featureCategory: string
  regulatorySensitivity: RegulatorySensitivity
  isNewProduct: boolean
  // Problem extraction
  coreProblem: string
  persona: string
  synonyms: string[]
  searchQueries: string[]
  /** 0..1 — how clearly the document states the problem (low ⇒ the analysis is guessing). */
  confidence: number
  rationale?: string
}

export type Sentiment = 'positive' | 'neutral' | 'negative'

export interface Evidence {
  title?: string
  url?: string
  snippet?: string
  sourceType?: string
  /** The search query that surfaced this evidence (traceability). */
  discoveredQuery?: string
}

export type FindingKind =
  | 'support'
  | 'contradict'
  | 'risk'
  | 'gap'
  | 'assumption'
  | 'edge_case'
  | 'insight'

/** A normalized, cross-agent unit the synthesis reasons over. */
export interface Finding {
  title: string
  detail: string
  kind?: FindingKind
  severity?: 'high' | 'medium' | 'low'
  /** 0..1 */
  confidence?: number
  evidence?: Evidence[]
}

export type AgentStatus = 'ok' | 'skipped' | 'error' | 'timeout'

/** Every agent returns this. `data` carries the agent-specific typed payload. */
export interface AgentResult<TData = unknown> {
  agentId: string
  summary: string
  findings: Finding[]
  /** 0..1 */
  confidence: number
  evidence?: Evidence[]
  data?: TData
  status: AgentStatus
  error?: string
  durationMs?: number
  /** Tokens this agent spent (real agents that call the LLM; absent for stubs). */
  usage?: TokenUsage
}

// --- Per-agent payload shapes (the spec's per-agent outputs) ---
export type CustomerVoiceRecommendation =
  | 'Build'
  | 'Validate First'
  | 'More Research Needed'
  | 'Weak Signal'

/** One real Reddit quote with its source + engagement strength. */
export interface CustomerVoiceEvidence {
  quote: string
  subreddit: string
  url: string
  /** Upvotes on the source post. */
  postScore: number
  /** Upvotes on the source comment (0 when the quote is from the post body). */
  commentScore: number
}

export interface CustomerVoiceTheme {
  name: string
  mentions: number
  /** 1–10 (frequency + emotion + engagement). */
  severity: number
  evidence: CustomerVoiceEvidence[]
}

export interface CustomerVoicePayload {
  /** 0–100. */
  confidence: number
  confidenceLabel: 'Low' | 'Medium' | 'High'
  discussionCount: number
  /** Breadth of the signal — distinct subreddits the evidence spans. */
  distinctSubreddits: string[]
  themes: CustomerVoiceTheme[]
  /** Who experiences the problem. */
  userSegments: string[]
  sentimentSummary: string
  recommendation: CustomerVoiceRecommendation
}
export interface ResearchPayload {
  supportingEvidence: Evidence[]
  contradictingEvidence: Evidence[]
  confidenceScore: number
}
export interface CompetitorPayload {
  competitors: string[]
  featureComparison: string[]
  gaps: string[]
}
export interface CompliancePayload {
  regulations: string[]
  risks: string[]
  requirements: string[]
}
export interface SolutionCriticPayload {
  assumptions: string[]
  risks: string[]
  edgeCases: string[]
}
export interface PrdQualityPayload {
  missingRequirements: string[]
  missingMetrics: string[]
  missingAcceptanceCriteria: string[]
}

/** The recommendation-engine verdict — "what should I do?". */
export type BuildDecision = 'build' | 'build_with_changes' | 'validate_first' | 'do_not_build'

export interface Decision {
  recommendation: BuildDecision
  /** 0..1 */
  confidence: number
  rationale: string[]
}

/** The final synthesis output. Reasoned across agent findings, not concatenated. */
export interface SynthesisReport {
  executiveSummary: string
  recommendation: string
  /** 0..1 */
  confidence: number
  supportingEvidence: string[]
  contradictingEvidence: string[]
  risks: string[]
  openQuestions: string[]
  suggestedExperiments: string[]
  missingRequirements: string[]
  finalVerdict: string
  decision: Decision
}

/** Everything an orchestration run produces. */
export interface OrchestrationResult {
  analysis: DocumentAnalysis
  results: AgentResult[]
  report: SynthesisReport
  ranAgentIds: string[]
  skippedAgentIds: string[]
  usage?: TokenUsage
}

// Re-export the domain context types agents commonly read from metadata.
export type { ReviewContext, UserContext }
