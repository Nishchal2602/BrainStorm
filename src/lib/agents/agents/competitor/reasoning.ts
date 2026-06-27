import type { TokenUsage } from '@/lib/types'
import type {
  CapabilityCell,
  Competitor,
  CompetitorRelationship,
  DifferentiationScores,
  DocumentAnalysis,
  MarketSegment,
  ProposalProfile,
  StrategicWhiteSpace,
} from '../../types'
import type { LlmPort } from '../../llm'

export interface RelationshipCall {
  competitor: string
  relationship: CompetitorRelationship
  reason: string
}
export interface MarketInsight {
  type: 'market_insight' | 'risk' | 'opportunity'
  statement: string
}
export interface ReasoningResult {
  proposal: ProposalProfile
  marketCategory: string
  marketMaturity: 'Low' | 'Medium' | 'High'
  segments: MarketSegment[]
  relationships: RelationshipCall[]
  whiteSpace: StrategicWhiteSpace[]
  scores: DifferentiationScores
  recommendation: string
  insights: MarketInsight[]
}

// Gemini responseSchema is an OpenAPI subset — no `additionalProperties`.
const SCHEMA = {
  type: 'object',
  properties: {
    proposal: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        primaryJob: { type: 'string' },
        architecture: { type: 'string' },
        positioning: { type: 'string' },
      },
      required: ['category', 'primaryJob', 'architecture', 'positioning'],
    },
    marketCategory: { type: 'string' },
    marketMaturity: { type: 'string', enum: ['Low', 'Medium', 'High'] },
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, competitors: { type: 'array', items: { type: 'string' } } },
        required: ['name', 'competitors'],
      },
    },
    relationships: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          competitor: { type: 'string' },
          relationship: { type: 'string', enum: ['direct', 'adjacent', 'substitute'] },
          reason: { type: 'string' },
        },
        required: ['competitor', 'relationship', 'reason'],
      },
    },
    whiteSpace: {
      type: 'array',
      items: {
        type: 'object',
        properties: { opportunity: { type: 'string' }, rationale: { type: 'string' } },
        required: ['opportunity', 'rationale'],
      },
    },
    scores: {
      type: 'object',
      properties: {
        marketOverlap: { type: 'number' },
        architectureNovelty: { type: 'number' },
        capabilityDifferentiation: { type: 'number' },
        positioningDifferentiation: { type: 'number' },
      },
      required: ['marketOverlap', 'architectureNovelty', 'capabilityDifferentiation', 'positioningDifferentiation'],
    },
    recommendation: { type: 'string' },
    insights: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['market_insight', 'risk', 'opportunity'] },
          statement: { type: 'string' },
        },
        required: ['type', 'statement'],
      },
    },
  },
  required: [
    'proposal',
    'marketCategory',
    'marketMaturity',
    'segments',
    'relationships',
    'whiteSpace',
    'scores',
    'recommendation',
    'insights',
  ],
} as const

const SYSTEM = `You are a senior product manager doing competitive analysis. You are given a product proposal and the REAL competitors already discovered (treat them as verified facts). Reason about the market like a strategy consultant — positioning over features.

1. proposal: read the PROPOSAL's own market category, primaryJob, architecture (how it would fundamentally work), and positioning.
2. relationships: classify EACH discovered competitor's relationship to THE PROPOSAL — "direct" (same job, same approach, same customer), "adjacent" (related/broader product whose job partly overlaps), or "substitute" (a different product people use instead). Give a one-line reason. Do NOT call everything direct.
3. segments: cluster the competitors into market segments by job/category.
4. whiteSpace: identify STRATEGIC positioning the proposal could own (e.g. persistent organizational memory, decision intelligence, cross-team reasoning) — NOT feature gaps (chat interface, permissions). Every opportunity MUST be justified by the ABSENCE of that positioning among the discovered competitors; in "rationale" name which competitors lack it. NEVER invent an opportunity you did not check against the list.
5. scores (each 0-100): marketOverlap (how crowded the same-job space is — high = crowded), architectureNovelty (how different the proposal's approach is from competitors), capabilityDifferentiation (how uncommon its planned capabilities are), positioningDifferentiation (how different its value proposition is).
6. marketCategory + marketMaturity (Low/Medium/High — how established the category is).
7. recommendation: 2-4 sentences a PM could paste into a strategy doc — name the market, the crowding, and where real differentiation lies.
8. insights: 3-6 market_insight / risk / opportunity statements grounded in the competitors above.

Base everything ONLY on the proposal + the listed competitors. Never invent competitors or capabilities.`

function digest(competitors: Competitor[], cells: CapabilityCell[]): string {
  const comps = competitors
    .map((c) => {
      const caps = c.capabilities.map((cap) => cap.name).join(', ') || '—'
      return `- ${c.name} | CATEGORY: ${c.category} | JOB: ${c.primaryJob || '—'} | ARCH: ${c.architecture} | POSITIONING: ${c.positioning || '—'}\n  capabilities: ${caps}`
    })
    .join('\n')
  const market = cells
    .slice(0, 12)
    .map((c) => `${c.name} (${c.adoption})`)
    .join(', ')
  return `COMPETITORS:\n${comps}\n\nMARKET CAPABILITIES (adoption): ${market || '—'}`
}

/** Step 4: structured market-reasoning over the discovered facts (no web search). */
export async function reasonMarket(
  llm: LlmPort,
  analysis: DocumentAnalysis | undefined,
  competitors: Competitor[],
  cells: CapabilityCell[],
  meta?: { clientId?: string },
): Promise<{ result: ReasoningResult; usage?: TokenUsage }> {
  const proposalCtx = [
    analysis?.coreProblem ? `Problem: ${analysis.coreProblem}` : '',
    analysis?.persona ? `Target user: ${analysis.persona}` : '',
    analysis?.productCategory ? `Product category: ${analysis.productCategory}` : '',
    analysis?.solutionCategory ? `Solution category: ${analysis.solutionCategory}` : '',
    analysis?.keyCapabilities?.length ? `Planned capabilities: ${analysis.keyCapabilities.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
  const user = `PROPOSAL:\n${proposalCtx}\n\n${digest(competitors, cells)}`

  const { data, usage } = await llm.generateStructured<ReasoningResult>({
    system: SYSTEM,
    user,
    schema: SCHEMA as object,
    maxTokens: 3500,
    label: 'competitor_reasoning',
    meta,
  })
  return { result: data, usage }
}
