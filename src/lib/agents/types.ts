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

// --- Customer Voice: claim-based validation ---
export type ClaimVerdict =
  | 'Strongly Supported'
  | 'Supported'
  | 'Mixed Evidence'
  | 'Weak Evidence'
  | 'Unsupported'

/** The PM-facing evidence-level conclusion. NEVER asserts demand is absent. */
export type EvidenceLevel = 'Strong evidence found' | 'Limited evidence found' | 'No evidence found'

/** One verbatim Reddit quote, verified against its source, with quality sub-scores (0–10). */
export interface ClaimEvidence {
  quote: string
  subreddit: string
  url: string
  /** Upvotes on the source post. */
  postScore: number
  /** Upvotes on the source comment (0 when the quote is from the post body). */
  commentScore: number
  relevanceScore: number
  evidenceStrength: number
  engagementScore: number
  authorCredibility: number
  /** Composite used to rank "strongest" evidence. */
  finalScore: number
}

export interface CustomerVoiceClaim {
  id: string
  claim: string
  verdict: ClaimVerdict
  /** 0–100, diversity-weighted. */
  confidence: number
  supportingCount: number
  contradictingCount: number
  /** Source breadth — how many distinct threads/subreddits the support spans. */
  sourceBreadth: { distinctThreads: number; distinctSubreddits: number }
  supporting: ClaimEvidence[]
  contradicting: ClaimEvidence[]
}

/** Who is feeling the pain (for ICP validation). */
export interface AffectedUser {
  segment: string
  mentions: number
}

export interface CustomerVoicePayload {
  claims: CustomerVoiceClaim[]
  claimsEvaluated: number
  discussionCount: number
  distinctSubreddits: string[]
  /** 0–100. */
  overallConfidence: number
  overallConfidenceLabel: 'Low' | 'Medium' | 'High'
  evidenceLevel: EvidenceLevel
  affectedUsers: AffectedUser[]
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
