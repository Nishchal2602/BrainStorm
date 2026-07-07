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
  /** The kind of solution proposed (e.g. "Enterprise AI Assistant"). Used for competitor discovery. */
  solutionCategory: string
  /** Concrete capabilities the proposal depends on (e.g. "RAG", "role awareness"). */
  keyCapabilities: string[]
  // --- Compact structured context (replaces re-sending the document downstream) ---
  /** Product/business goals the document states (≤5, short). */
  goals: string[]
  /** The most important functional requirements (≤5, short). */
  keyRequirements: string[]
  /** Constraints and explicit non-goals (≤5, short). */
  constraints: string[]
  /** One-two sentences: the core user workflow/journey the proposal changes. */
  workflowSummary: string
  /** What the document claims makes this different (≤4, short). */
  differentiators: string[]
  /** One-two sentences: how the solution is architected/built. */
  architectureSummary: string
  /** Success metrics the document defines (≤4, short). */
  successMetrics: string[]
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

// --- Customer Voice: hypothesis validation engine ---
/** The category of product assumption a hypothesis tests. */
export type HypothesisCategory = 'problem' | 'persona' | 'workflow' | 'solution' | 'market'

/** Per-hypothesis verdict. `insufficient_evidence` = "not enough public discussion to
 * validate" — NEVER "the assumption is false". */
export type HypothesisVerdict = 'supported' | 'mixed' | 'insufficient_evidence' | 'contradicted'

/** The PM-facing evidence-level conclusion. NEVER asserts demand is absent. */
export type EvidenceLevel =
  | 'Strong evidence found'
  | 'Limited evidence found'
  | 'Insufficient public evidence'

/** One verbatim Reddit quote, verified against its source, with quality sub-scores (0–10). */
export interface HypothesisEvidence {
  quote: string
  subreddit: string
  url: string
  /** Reddit author (for distinct-author diversity); undefined when unknown. */
  author?: string
  /** Upvotes on the source post. */
  postScore: number
  /** Upvotes on the source comment (0 when the quote is from the post body). */
  commentScore: number
  /** How directly the unit speaks to the hypothesis's problem. */
  problemMatch: number
  /** How well the author matches the target persona. */
  personaMatch: number
  /** Same product/domain as the hypothesis (guards cross-domain merges). */
  productMatch: number
  evidenceStrength: number
  engagementScore: number
  authorCredibility: number
  /** Composite used to rank "strongest" evidence + drive confidence. */
  finalScore: number
}

export interface CustomerVoiceHypothesis {
  id: string
  /** The assumption under test, in plain language. */
  statement: string
  category: HypothesisCategory
  verdict: HypothesisVerdict
  /** 0–100 = Quality × Diversity × Agreement × Relevance. */
  confidence: number
  /** Average-final-score band over supporting evidence. */
  evidenceQuality: 'High' | 'Medium' | 'Low'
  supportingCount: number
  contradictingCount: number
  /** Source breadth — distinct threads / subreddits / authors the support spans. */
  sourceBreadth: { distinctThreads: number; distinctSubreddits: number; distinctAuthors: number }
  supporting: HypothesisEvidence[]
  contradicting: HypothesisEvidence[]
}

/** Who is feeling the pain (for ICP validation). */
export interface AffectedUser {
  segment: string
  mentions: number
}

export interface CustomerVoicePayload {
  hypotheses: CustomerVoiceHypothesis[]
  hypothesesEvaluated: number
  supportedCount: number
  mixedCount: number
  insufficientCount: number
  contradictedCount: number
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
// --- Competitor Intelligence: market positioning & white-space reasoning ---
/** How a product relates to THIS proposal — keeps adjacent products/substitutes from
 * reading as head-on competitors. */
export type CompetitorRelationship = 'direct' | 'adjacent' | 'substitute'
/** How saturated a capability is across the market (derived from adoption). */
export type Maturity = 'very_emerging' | 'emerging' | 'maturing' | 'mature' | 'very_mature'
/** A capability's standing vs the proposal + market. */
export type GapStatus = 'Unique' | 'Rare' | 'Common' | 'Commodity' | 'Missing'

/** Where a claimed capability was sourced (URL + short quote). Model-grounded, not re-fetched. */
export interface CapabilityEvidence {
  url?: string
  quote?: string
}
export interface CompetitorCapability {
  name: string
  evidence: CapabilityEvidence
}
export interface Competitor {
  name: string
  url: string
  /** Market category (e.g. "Enterprise Search", "Enterprise AI Assistant"). */
  category: string
  /** The main job customers buy it for (never just "AI"). */
  primaryJob: string
  /** One sentence on how it positions itself. */
  positioning: string
  /** One sentence on how it fundamentally works (e.g. "RAG over enterprise knowledge"). */
  architecture: string
  targetCustomer?: string
  /** 0–100; competitors below the threshold are dropped (anti-hallucination). */
  confidence: number
  relationship: CompetitorRelationship
  relationshipReason?: string
  capabilities: CompetitorCapability[]
  strengths: string[]
  weaknesses: string[]
}
/** A market cluster of competitors by job/category. */
export interface MarketSegment {
  name: string
  competitors: string[]
}
/** A strategic gap — justified by the ABSENCE of this positioning among discovered competitors. */
export interface StrategicWhiteSpace {
  opportunity: string
  rationale?: string
}
/** The model's read of the proposal itself, for positioning comparison. */
export interface ProposalProfile {
  category: string
  primaryJob: string
  architecture: string
  positioning: string
}
/** Four independent 0–100 differentiation dimensions (positioning + architecture weighted most). */
export interface DifferentiationScores {
  marketOverlap: number
  architectureNovelty: number
  capabilityDifferentiation: number
  positioningDifferentiation: number
}
/** One capability rolled up across the kept competitors (secondary view). */
export interface CapabilityCell {
  name: string
  /** How many competitors offer it. */
  adoption: number
  competitors: string[]
  maturity: Maturity
  status: GapStatus
}
export interface LandscapeSignal {
  kind: 'incomplete_landscape' | 'crowded' | 'sparse'
  message: string
}
/** Reusable market view (Proposal · Competitors · Segments · Capabilities · White space · Signals). */
export interface MarketLandscape {
  proposal: ProposalProfile
  category: string
  maturity: 'Low' | 'Medium' | 'High'
  competitors: Competitor[]
  segments: MarketSegment[]
  capabilities: CapabilityCell[]
  whiteSpace: StrategicWhiteSpace[]
  signals: LandscapeSignal[]
}
export interface CompetitorPayload {
  landscape: MarketLandscape
  productCategory: string
  competitorsFound: number
  /** 0–100 = 0.30·Positioning + 0.30·Architecture + 0.20·Capability + 0.20·(100−MarketOverlap). */
  differentiationScore: number
  differentiation: 'Low' | 'Medium' | 'High'
  differentiationScores: DifferentiationScores
  /** Strategy-consultant narrative. */
  recommendation: string
  /** Raw grounded model output (facts + reasoning template). Captured for
   * analytics, stripped from the payload before it ships to the UI. */
  raw?: string
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
// --- PM Review: Staff-PM implementation-readiness reviewer ---
/** Typed review + pre-built cards; the shared parser lives in features/pmReview. */
export interface PmReviewAgentPayload {
  review: import('@/lib/features/pmReview').ReadinessReview
  sections: import('@/lib/types').Section[]
  /** Raw XML the agent parsed. Captured for analytics, stripped before UI. */
  raw?: string
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
  /** Per-stage usage for analytics (the shared analyze + synthesis calls,
   * which aren't agents in `results`). */
  analyzeUsage?: TokenUsage
  synthesisUsage?: TokenUsage
}

// Re-export the domain context types agents commonly read from metadata.
export type { ReviewContext, UserContext }
