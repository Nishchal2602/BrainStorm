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

/** Output of the orchestrator's Step 1 PRD analysis. */
export interface Classification {
  industry: string
  productCategory: string
  featureCategory: string
  regulatorySensitivity: RegulatorySensitivity
  isNewProduct: boolean
  rationale?: string
}

export interface Evidence {
  title?: string
  url?: string
  snippet?: string
  sourceType?: string
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
}

// --- Per-agent payload shapes (the spec's per-agent outputs) ---
export interface CustomerVoicePayload {
  recurringPainPoints: string[]
  userSegments: string[]
  sentimentSummary: string
  supportingEvidence: Evidence[]
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
  classification: Classification
  results: AgentResult[]
  report: SynthesisReport
  ranAgentIds: string[]
  skippedAgentIds: string[]
  usage?: TokenUsage
}

// Re-export the domain context types agents commonly read from metadata.
export type { ReviewContext, UserContext }
