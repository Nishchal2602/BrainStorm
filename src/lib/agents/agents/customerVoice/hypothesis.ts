import type { TokenUsage } from '@/lib/types'
import type { HypothesisCategory } from '../../types'
import type { LlmPort } from '../../llm'
import type { DocumentAnalysis } from '../../types'

/**
 * A product assumption to validate. The LLM produces the *raw material* —
 * statement + searchIntent + the vernacular customers actually use — and NEVER
 * the query strings themselves. `queries.ts` (pure) turns this into the actual
 * supporting/contradicting/synonym/long-tail searches, so retrieval can evolve
 * without changing the LLM output schema.
 */
export interface Hypothesis {
  id: string
  statement: string
  category: HypothesisCategory
  /** 0–1: how strongly the document depends on this assumption. */
  confidence: number
  /** What to look for, in plain language (drives query building). */
  searchIntent: string
  /** The exact phrases real users type ("paste context every time"). */
  customerLanguage: string[]
}

const MAX_HYPOTHESES = 7
const VALID_CATEGORIES: HypothesisCategory[] = [
  'problem',
  'persona',
  'workflow',
  'solution',
  'market',
]

// Gemini responseSchema is an OpenAPI subset — no `additionalProperties`.
const SCHEMA = {
  type: 'object',
  properties: {
    hypotheses: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          statement: { type: 'string' },
          category: { type: 'string', enum: VALID_CATEGORIES },
          confidence: { type: 'number' },
          searchIntent: { type: 'string' },
          customerLanguage: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'statement', 'category', 'confidence', 'searchIntent', 'customerLanguage'],
      },
    },
  },
  required: ['hypotheses'],
} as const

const SYSTEM = `You are a product researcher. Turn a product document into the underlying ASSUMPTIONS the product depends on — not a restatement of its sentences.

Output 5–7 DISTINCT hypotheses. A hypothesis is a single, falsifiable assumption about what users actually experience, want, or do, phrased so a real discussion could clearly SUPPORT or CONTRADICT it. Extract the assumption BEHIND the wording:
- doc says "AI lacks company context" → hypothesis "Users repeatedly re-supply company context to AI tools".
- doc says "role-aware outputs" → hypothesis "AI outputs are not tailored to the user's role".
Hypotheses must be genuinely different (different root assumption), NOT rephrasings of one another.

For each hypothesis provide:
- category: which kind of assumption it is — problem | persona | workflow | solution | market.
- confidence: 0–1, how strongly the document depends on this assumption.
- searchIntent: one plain-language sentence describing what evidence would validate it.
- customerLanguage: 3–6 short phrases in the EXACT words real users type when they hit this — vernacular, not product/marketing terms (e.g. "have to paste context every time", "chatgpt forgets what we discussed", "doesn't know our codebase"). Never broad category terms ("enterprise ai", "context aware ai").

Do NOT write search queries — just the customer phrases.`

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'is', 'are', 'be', 'it', 'that',
  'this', 'with', 'as', 'ai', 'because', 'due', 'lacks', 'lack', 'no', 'not', 'they', 'their',
  'users', 'user', 'use', 'using', 'tools', 'tool',
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

/** Drop near-duplicate hypotheses (same root assumption) so verdicts aren't inflated. */
function dedupe(hyps: Hypothesis[]): Hypothesis[] {
  const kept: { hyp: Hypothesis; toks: Set<string> }[] = []
  for (const h of hyps) {
    const toks = tokens(h.statement)
    if (kept.some((k) => jaccard(k.toks, toks) > 0.6)) continue
    kept.push({ hyp: h, toks })
    if (kept.length >= MAX_HYPOTHESES) break
  }
  return kept.map((k) => k.hyp)
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5)
const strArr = (v: unknown, cap: number): string[] =>
  (Array.isArray(v) ? v : [])
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, cap)

/** Step 1: extract the distinct assumptions the product depends on, with the
 * customer vernacular needed to find evidence. */
export async function extractHypotheses(
  llm: LlmPort,
  analysis: DocumentAnalysis | undefined,
  problem: string,
  meta?: { clientId?: string },
): Promise<{ hypotheses: Hypothesis[]; usage?: TokenUsage }> {
  const user = [
    `PROBLEM: ${problem}`,
    analysis?.persona ? `Primary user: ${analysis.persona}` : '',
    analysis?.productCategory ? `Product category: ${analysis.productCategory}` : '',
    analysis?.synonyms?.length ? `Related phrasings: ${analysis.synonyms.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const { data, usage } = await llm.generateStructured<{ hypotheses: Hypothesis[] }>({
      system: SYSTEM,
      user,
      schema: SCHEMA as object,
      maxTokens: 1100,
      label: 'customer_voice_hypotheses',
      meta,
    })
    const raw = Array.isArray(data?.hypotheses) ? data.hypotheses : []
    const normalized: Hypothesis[] = raw
      .map((h, i) => ({
        id: typeof h?.id === 'string' && h.id.trim() ? h.id.trim() : `h${i + 1}`,
        statement: typeof h?.statement === 'string' ? h.statement.trim() : '',
        category: VALID_CATEGORIES.includes(h?.category) ? h.category : 'problem',
        confidence: clamp01(h?.confidence),
        searchIntent: typeof h?.searchIntent === 'string' ? h.searchIntent.trim() : '',
        customerLanguage: strArr(h?.customerLanguage, 6),
      }))
      .filter((h) => h.statement.length > 0)
    const hypotheses = dedupe(normalized)
    if (hypotheses.length) return { hypotheses, usage }
  } catch {
    /* fall through to synthetic hypothesis */
  }

  // Fallback: a single synthetic hypothesis from the analysis.
  if (!problem) return { hypotheses: [] }
  return {
    hypotheses: [
      {
        id: 'h1',
        statement: problem,
        category: 'problem',
        confidence: clamp01(analysis?.confidence ?? 0.5),
        searchIntent: problem,
        customerLanguage: strArr(analysis?.synonyms, 6),
      },
    ],
  }
}
