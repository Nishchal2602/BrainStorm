// Shared domain types for PM Co-Pilot.

export type ModelId = 'claude-sonnet-4-6' | 'claude-haiku-4-5'
/** User's model preference: 'auto' uses each feature's recommended model. */
export type ModelSetting = 'auto' | ModelId
export type PMMode = 'pm' | 'founder' | 'product_analyst'
export type ResearchDepth = 'quick' | 'standard' | 'deep'
export type DetectedSource =
  | 'jira'
  | 'confluence'
  | 'notion'
  | 'linear'
  | 'gdocs'
  | 'generic'
export type FeatureId = 'pm_review' | 'action_items' | 'slack_update' | 'summarize'

// --- Onboarding profile + per-review context ---
export type UserRole =
  | 'product_manager'
  | 'founder'
  | 'product_designer'
  | 'engineer'
  | 'other'
export type ExperienceLevel = '0-2' | '3-5' | '6-10' | '10+'
export type Industry =
  | 'saas'
  | 'ai'
  | 'fintech'
  | 'ecommerce'
  | 'healthcare'
  | 'consumer'
  | 'enterprise'
  | 'other'
export type CompanyStage = 'startup' | 'growth' | 'enterprise'
export type ReviewType =
  | 'prd'
  | 'feature_spec'
  | 'user_story'
  | 'roadmap'
  | 'product_strategy'
  | 'brainstorming'
  | 'exec_comm'
export type FamiliarityLevel = 'exploring' | 'some_knowledge' | 'domain_expert'

/** One-time onboarding profile, attached to every review. Persisted. */
export interface UserContext {
  role: UserRole | ''
  experienceLevel: ExperienceLevel | ''
  companyName: string
  industry: Industry | ''
  companyStage: CompanyStage | ''
  productName: string
  productDescription: string
  primaryUser: string
  businessGoal: string
  /** Set when onboarding is completed (presence ⇒ onboarded). */
  onboardedAt?: number
}

/** Per-review context collected before each PM Review. Not persisted as profile. */
export interface ReviewContext {
  featureName: string
  problemStatement: string
  targetUser: string
  successMetric: string
  reviewType: ReviewType
  familiarityLevel: FamiliarityLevel
}

export interface Settings {
  /** Optional BYOK key — only used when no proxy is configured at build time. */
  apiKey: string
  model: ModelSetting
  mode: PMMode
  researchDepth: ResearchDepth
  /** When true, features return sample outputs with no API call (manual testing). */
  demoMode: boolean
}

export interface PageContext {
  url: string
  title: string
  source: DetectedSource
  selection: string
  content: string
  truncated: boolean
  /** Compact h1–h3 table-of-contents (structure map), may be absent. */
  outline?: string
  /** Best-effort source-specific key/value fields (e.g. Jira status/priority). */
  fields?: Array<{ label: string; value: string }>
}

/** Provider-neutral token accounting for one generate() call. */
export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  thoughtsTokens?: number
  totalTokens?: number
}

export type EvidenceType = 'Research Paper' | 'Customer Voice' | 'Competitor' | 'Regulatory'
export type Confidence = 'High' | 'Medium' | 'Low'

/** A card's visual intent — drives accent color in the UI. */
export type SectionTone =
  | 'default'
  | 'insight'
  | 'risk'
  | 'implementation'
  | 'unknown'
  | 'recommendation'
  | 'sources'

/** One rendered card. The same shape backs every feature's output. */
export interface Section {
  heading: string
  body?: string
  bullets?: string[]
  tone?: SectionTone
  // PM Review insight metadata:
  confidence?: Confidence
  evidenceType?: EvidenceType
  sourceUrl?: string
}

export interface SourceRef {
  title?: string
  url: string
}

export interface ResultDoc {
  feature: FeatureId
  title: string
  sections: Section[]
  sources?: SourceRef[]
  /** Plain text used by the Copy button. */
  copyText: string
  /** Token usage for this run (live calls only; absent in demo). */
  usage?: TokenUsage
}

export interface HistoryEntry {
  id: string
  timestamp: number
  pageTitle: string
  url: string
  source: DetectedSource
  feature: FeatureId
  mode: PMMode
  result: ResultDoc
}
