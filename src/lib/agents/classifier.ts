import type { TokenUsage } from '@/lib/types'
import type { LlmPort } from './llm'
import type { Logger } from './logger'
import type { AgentContext, Classification, RegulatorySensitivity } from './types'

// Note: Gemini responseSchema is an OpenAPI subset — no `additionalProperties`.
const SCHEMA = {
  type: 'object',
  properties: {
    industry: { type: 'string' },
    productCategory: { type: 'string' },
    featureCategory: { type: 'string' },
    regulatorySensitivity: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
    isNewProduct: { type: 'boolean' },
    rationale: { type: 'string' },
  },
  required: [
    'industry',
    'productCategory',
    'featureCategory',
    'regulatorySensitivity',
    'isNewProduct',
    'rationale',
  ],
} as const

const SYSTEM = `You are a product analyst classifying a PRD/product document. Read the document (and any provided context) and classify it concisely.
- industry: the market the product serves (e.g. "Fintech", "Healthcare", "SaaS", "E-commerce", "Consumer"). Use "Unknown" if unclear.
- productCategory: what kind of product (e.g. "Payments", "Analytics", "Onboarding", "Messaging").
- featureCategory: the specific change under review (e.g. "KYC onboarding flow", "Dashboard redesign", "New API").
- regulatorySensitivity: "high" for finance/health/privacy/safety-regulated domains, "medium" if some compliance applies, "low" if minor, "none" if not regulated.
- isNewProduct: true if this proposes a brand-new product/feature with no existing baseline; false for changes/improvements to something that exists.
- rationale: one sentence justifying the classification.
Base everything on the document; do not invent specifics.`

const DEFAULT: Classification = {
  industry: 'Unknown',
  productCategory: 'Unknown',
  featureCategory: 'Unknown',
  regulatorySensitivity: 'low',
  isNewProduct: false,
  rationale: 'Classification unavailable; used safe defaults.',
}

const VALID_SENS: RegulatorySensitivity[] = ['none', 'low', 'medium', 'high']

/** Step 1 of the orchestrator: a single cheap structured call to classify the PRD. */
export class Classifier {
  constructor(
    private readonly llm: LlmPort,
    private readonly logger: Logger,
  ) {}

  async classify(ctx: AgentContext): Promise<{ classification: Classification; usage?: TokenUsage }> {
    const user = [
      ctx.featureName ? `Feature under review: ${ctx.featureName}` : '',
      ctx.productName ? `Product: ${ctx.productName}` : '',
      ctx.industry ? `Stated industry: ${ctx.industry}` : '',
      '\nDOCUMENT:\n' + ctx.document,
    ]
      .filter(Boolean)
      .join('\n')

    try {
      const { data, usage } = await this.llm.generateStructured<Classification>({
        system: SYSTEM,
        user,
        schema: SCHEMA as object,
        maxTokens: 400,
        label: 'classify',
        meta: ctx.metadata?.clientId ? { clientId: String(ctx.metadata.clientId) } : undefined,
      })
      const sens = VALID_SENS.includes(data.regulatorySensitivity)
        ? data.regulatorySensitivity
        : 'low'
      return { classification: { ...DEFAULT, ...data, regulatorySensitivity: sens }, usage }
    } catch (e) {
      this.logger.warn('classify failed; using defaults', e instanceof Error ? e.message : e)
      return { classification: DEFAULT }
    }
  }
}
