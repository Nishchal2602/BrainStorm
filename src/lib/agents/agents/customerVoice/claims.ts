import type { TokenUsage } from '@/lib/types'
import type { LlmPort } from '../../llm'
import type { DocumentAnalysis } from '../../types'

export interface Claim {
  id: string
  claim: string
  supportingQueries: string[]
  contradictingQueries: string[]
}

const MAX_CLAIMS = 5

// Gemini responseSchema is an OpenAPI subset — no `additionalProperties`.
const SCHEMA = {
  type: 'object',
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          claim: { type: 'string' },
          supportingQueries: { type: 'array', items: { type: 'string' } },
          contradictingQueries: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'claim', 'supportingQueries', 'contradictingQueries'],
      },
    },
  },
  required: ['claims'],
} as const

const SYSTEM = `You turn a product problem into falsifiable validation claims for customer research.

Output 3–5 DISTINCT claims. Each claim is a single, specific, falsifiable assertion about what users actually experience or want — phrased so a Reddit discussion could clearly SUPPORT or CONTRADICT it. Claims must be genuinely different problems, NOT rephrasings of the same root issue (e.g. "AI lacks company context" and "AI gives generic answers due to missing context" are the SAME claim — output one).

For each claim provide:
- supportingQueries: 3 Reddit search queries phrased like real users complaining (e.g. "chatgpt doesn't know company context reddit").
- contradictingQueries: 2 Reddit search queries that would surface people who do NOT have the problem / are satisfied (e.g. "we use ai successfully with internal docs reddit", "copilot understands our codebase reddit").
NEVER emit broad category terms ("enterprise ai", "context aware ai"). Make every query specific enough to validate the claim.`

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'is', 'are', 'be', 'it', 'that',
  'this', 'with', 'as', 'ai', 'because', 'due', 'lacks', 'lack', 'no', 'not', 'they', 'their',
])

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

/** Drop near-duplicate claims (same root problem) so verdicts aren't inflated. */
function dedupe(claims: Claim[]): Claim[] {
  const kept: { claim: Claim; toks: Set<string> }[] = []
  for (const c of claims) {
    const toks = tokens(c.claim)
    if (kept.some((k) => jaccard(k.toks, toks) > 0.6)) continue
    kept.push({ claim: c, toks })
    if (kept.length >= MAX_CLAIMS) break
  }
  return kept.map((k) => k.claim)
}

const strArr = (v: unknown, cap: number): string[] =>
  (Array.isArray(v) ? v : [])
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, cap)

/** Step 1: extract distinct falsifiable claims + supporting/contradicting queries. */
export async function extractClaims(
  llm: LlmPort,
  analysis: DocumentAnalysis | undefined,
  problem: string,
  meta?: { clientId?: string },
): Promise<{ claims: Claim[]; usage?: TokenUsage }> {
  const user = [
    `PROBLEM: ${problem}`,
    analysis?.persona ? `Primary user: ${analysis.persona}` : '',
    analysis?.productCategory ? `Product category: ${analysis.productCategory}` : '',
    analysis?.synonyms?.length ? `Related phrasings: ${analysis.synonyms.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const { data, usage } = await llm.generateStructured<{ claims: Claim[] }>({
      system: SYSTEM,
      user,
      schema: SCHEMA as object,
      maxTokens: 900,
      label: 'customer_voice_claims',
      meta,
    })
    const raw = Array.isArray(data?.claims) ? data.claims : []
    const normalized: Claim[] = raw
      .map((c, i) => ({
        id: typeof c?.id === 'string' && c.id.trim() ? c.id.trim() : `c${i + 1}`,
        claim: typeof c?.claim === 'string' ? c.claim.trim() : '',
        supportingQueries: strArr(c?.supportingQueries, 3),
        contradictingQueries: strArr(c?.contradictingQueries, 2),
      }))
      .filter((c) => c.claim.length > 0)
    const claims = dedupe(normalized)
    if (claims.length) return { claims, usage }
  } catch {
    /* fall through to synthetic claim */
  }

  // Fallback: a single synthetic claim from the analysis.
  if (!problem) return { claims: [] }
  return {
    claims: [
      {
        id: 'c1',
        claim: problem,
        supportingQueries: strArr(analysis?.searchQueries, 3),
        contradictingQueries: [],
      },
    ],
  }
}
