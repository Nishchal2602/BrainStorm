import type { TokenUsage } from '@/lib/types'
import type { LlmPort } from './llm'
import type { Logger } from './logger'
import type { AgentContext, DocumentAnalysis, RegulatorySensitivity } from './types'

// Note: Gemini responseSchema is an OpenAPI subset — no `additionalProperties`.
const SCHEMA = {
  type: 'object',
  properties: {
    industry: { type: 'string' },
    productCategory: { type: 'string' },
    featureCategory: { type: 'string' },
    regulatorySensitivity: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
    isNewProduct: { type: 'boolean' },
    coreProblem: { type: 'string' },
    persona: { type: 'string' },
    synonyms: { type: 'array', items: { type: 'string' } },
    searchQueries: { type: 'array', items: { type: 'string' } },
    solutionCategory: { type: 'string' },
    keyCapabilities: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number' },
    rationale: { type: 'string' },
  },
  required: [
    'industry',
    'productCategory',
    'featureCategory',
    'regulatorySensitivity',
    'isNewProduct',
    'coreProblem',
    'persona',
    'synonyms',
    'searchQueries',
    'solutionCategory',
    'keyCapabilities',
    'confidence',
    'rationale',
  ],
} as const

const SYSTEM = `You analyze a PRD/product document in ONE pass — classify it AND extract the real underlying problem with a web-search plan. Be concise; base everything on the document, never invent specifics.

Classification:
- industry: market served (e.g. "Fintech", "Healthcare", "SaaS", "E-commerce", "Consumer"). "Unknown" if unclear.
- productCategory: kind of product (e.g. "Payments", "Analytics", "Onboarding").
- featureCategory: the specific change under review.
- regulatorySensitivity: "high" for finance/health/privacy/safety-regulated, "medium" if some compliance applies, "low" if minor, "none" if not regulated.
- isNewProduct: true for a brand-new product/feature with no baseline; false for a change to something existing.

Problem extraction (look past the document's wording to the REAL user problem):
- coreProblem: the concrete user problem in plain language (e.g. doc says "improve onboarding completion" → coreProblem "users abandon onboarding during identity verification").
- persona: the primary affected user.
- synonyms: 3–6 alternative phrasings real users would use (e.g. "KYC delay", "verification friction", "signup abandonment").
- searchQueries: 4–6 concrete web-search queries to find real user discussions of this problem (favor terms users actually type).
- solutionCategory: the kind of solution the document proposes (e.g. "Enterprise AI Assistant", "Payments Onboarding"). "Unknown" if unclear.
- keyCapabilities: 4–8 concrete capabilities the proposed solution depends on (e.g. "RAG", "knowledge graph", "role awareness", "enterprise search"). Capabilities, not benefits.
- confidence: 0..1 — how clearly the document states the problem. High (~0.9) when explicit and specific; low (~0.4) when vague (e.g. just "improve onboarding"). Be honest when you are guessing.
- rationale: one sentence.`

const DEFAULT: DocumentAnalysis = {
  industry: 'Unknown',
  productCategory: 'Unknown',
  featureCategory: 'Unknown',
  regulatorySensitivity: 'low',
  isNewProduct: false,
  coreProblem: '',
  persona: '',
  synonyms: [],
  searchQueries: [],
  solutionCategory: 'Unknown',
  keyCapabilities: [],
  confidence: 0,
  rationale: 'Document analysis unavailable; used safe defaults.',
}

const VALID_SENS: RegulatorySensitivity[] = ['none', 'low', 'medium', 'high']
const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

/** Orchestrator Step 1: one structured call that classifies the doc AND extracts
 * the real problem + search plan. Shared by all agents. */
export class DocumentAnalyzer {
  constructor(
    private readonly llm: LlmPort,
    private readonly logger: Logger,
  ) {}

  async analyze(ctx: AgentContext): Promise<{ analysis: DocumentAnalysis; usage?: TokenUsage }> {
    const user = [
      ctx.featureName ? `Feature under review: ${ctx.featureName}` : '',
      ctx.productName ? `Product: ${ctx.productName}` : '',
      ctx.industry ? `Stated industry: ${ctx.industry}` : '',
      '\nDOCUMENT:\n' + ctx.document,
    ]
      .filter(Boolean)
      .join('\n')

    try {
      const { data, usage } = await this.llm.generateStructured<DocumentAnalysis>({
        system: SYSTEM,
        user,
        schema: SCHEMA as object,
        maxTokens: 700,
        label: 'analyze',
        meta: ctx.metadata?.clientId ? { clientId: String(ctx.metadata.clientId) } : undefined,
      })
      const sens = VALID_SENS.includes(data.regulatorySensitivity)
        ? data.regulatorySensitivity
        : 'low'
      const analysis: DocumentAnalysis = {
        ...DEFAULT,
        ...data,
        regulatorySensitivity: sens,
        synonyms: strArr(data.synonyms),
        searchQueries: strArr(data.searchQueries),
        keyCapabilities: strArr(data.keyCapabilities),
        confidence: clamp01(data.confidence),
      }
      return { analysis, usage }
    } catch (e) {
      this.logger.warn('analyze failed; using defaults', e instanceof Error ? e.message : e)
      return { analysis: DEFAULT }
    }
  }
}
