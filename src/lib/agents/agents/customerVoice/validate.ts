import type { ReviewContext, TokenUsage } from '@/lib/types'
import type { DocumentAnalysis, HypothesisCategory } from '../../types'
import type { LlmPort } from '../../llm'
import { compactContext } from '../shared'
import type { DiscussionUnit } from './types'
import type { Judgment } from './verify'

/**
 * THE Customer Voice LLM call — claim extraction + evidence judgment merged into
 * one pass (was two calls: extractHypotheses → verifyEvidence). Retrieval runs
 * BEFORE this call (queries come from DocumentAnalysis), so the model reads the
 * compact product context plus the real discussion units and returns the final
 * grouped claims with per-unit judgments. All scoring stays pure (score.ts).
 */

/** A product assumption to validate. `searchIntent`/`customerLanguage` are
 * legacy-optional: queries no longer derive from them, but older stored runs
 * and fixtures may still carry them. */
export interface Hypothesis {
  id: string
  statement: string
  category: HypothesisCategory
  /** 0–1: how strongly the document depends on this assumption. */
  confidence: number
  searchIntent?: string
  customerLanguage?: string[]
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
// `reasoning` is deliberately NOT requested (never read by scoring).
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
        },
        required: ['id', 'statement', 'category', 'confidence'],
      },
    },
    judgments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          unitIndex: { type: 'number' },
          hypothesisId: { type: 'string' },
          stance: { type: 'string', enum: ['supports', 'contradicts', 'unrelated'] },
          quote: { type: 'string' },
          problemMatch: { type: 'number' },
          personaMatch: { type: 'number' },
          productMatch: { type: 'number' },
          evidenceStrength: { type: 'number' },
          authorCredibility: { type: 'number' },
          segment: { type: 'string' },
        },
        required: [
          'unitIndex',
          'hypothesisId',
          'stance',
          'quote',
          'problemMatch',
          'personaMatch',
          'productMatch',
          'evidenceStrength',
          'authorCredibility',
          'segment',
        ],
      },
    },
  },
  required: ['hypotheses', 'judgments'],
} as const

function systemPrompt(persona: string, domain: string): string {
  return `You are a product researcher validating a product's assumptions against real user discussions, in ONE pass.

STEP 1 — CLAIMS. From the PRODUCT CONTEXT, extract 5–7 DISTINCT falsifiable claims (assumptions about what users actually experience, want, or do), phrased so a real discussion could clearly SUPPORT or CONTRADICT each. Extract the assumption BEHIND the wording (doc says "AI lacks company context" → claim "Users repeatedly re-supply company context to AI tools"). GROUP similar claims into one — never output rephrasings of the same root assumption. Return ONLY the final grouped claims, no intermediate variants.
For each claim: id (h1…h7), statement, category (problem | persona | workflow | solution | market), confidence 0–1 (how strongly the document depends on it).

STEP 2 — EVIDENCE. Judge EVERY unit below (each unit is one Reddit post or comment). For each unit, decide which ONE claim (by id) it most directly addresses, then judge it:
${persona ? `Target persona: ${persona}\n` : ''}${domain ? `Product domain: ${domain}\n` : ''}
- stance: "supports" (evidence the claim is TRUE), "contradicts" (evidence it is FALSE / the person does NOT have the problem), or "unrelated" (off-topic, or merely same broad topic). Same industry/topic is NOT relevance.
- quote: copy a VERBATIM substring from THAT unit's text (exact characters) — never paraphrase or invent. If no verbatim sentence genuinely fits, mark the unit "unrelated".
- problemMatch 0-10: how directly the unit describes the SPECIFIC problem in the claim (not just the same area).
- personaMatch 0-10: how well the author looks like the target persona (use flair/role signals; ~5 if unknown, lower if clearly a different audience).
- productMatch 0-10: whether it concerns the SAME product/domain. A different domain scores LOW even if the wording is similar.
- evidenceStrength 0-10: first-hand, specific lived experience (high) vs vague/second-hand (low).
- authorCredibility 0-10: from flair/role signals (practitioner/engineer/PM/founder). ~5 if unknown.
- segment: the author's role/segment if evident (e.g. "Software Engineer", "Product Manager", "Founder"); else "".
You MAY omit clearly unrelated units. Be strict: precision over coverage.`
}

function renderUnits(units: DiscussionUnit[]): string {
  return units
    .map((u, i) => {
      const who = u.author ? `by ${u.author}${u.authorFlair ? ` [${u.authorFlair}]` : ''}` : ''
      return `[${i}] r/${u.subreddit} (▲${u.score}) ${who}\n${u.text}`
    })
    .join('\n\n')
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5)

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

/** Drop near-duplicate claims AND remap their ids to the surviving claim, so
 * judgments referencing a deduped-away id are re-pointed instead of orphaned. */
export function dedupeHypothesesWithIdRemap(hyps: Hypothesis[]): {
  hypotheses: Hypothesis[]
  remap: Map<string, string>
} {
  const kept: { hyp: Hypothesis; toks: Set<string> }[] = []
  const remap = new Map<string, string>()
  for (const h of hyps) {
    const toks = tokens(h.statement)
    const dup = kept.find((k) => jaccard(k.toks, toks) > 0.6)
    if (dup) {
      remap.set(h.id, dup.hyp.id)
      continue
    }
    if (kept.length >= MAX_HYPOTHESES) continue
    kept.push({ hyp: h, toks })
    remap.set(h.id, h.id)
  }
  return { hypotheses: kept.map((k) => k.hyp), remap }
}

export interface ValidationResult {
  hypotheses: Hypothesis[]
  judgments: Judgment[]
  usage?: TokenUsage
}

/** The single merged call: claims + judgments over the provided (pre-capped) units. */
export async function validateClaims(
  llm: LlmPort,
  analysis: DocumentAnalysis | undefined,
  review: ReviewContext | undefined,
  problem: string,
  units: DiscussionUnit[],
  meta?: { clientId?: string },
): Promise<ValidationResult> {
  const domain = [analysis?.productCategory, analysis?.industry].filter(Boolean).join(' · ')
  const context = compactContext(analysis, review) || `PRODUCT CONTEXT:\nProblem: ${problem}`
  const user = `${context}\n\nUNITS:\n${renderUnits(units)}`

  try {
    const { data, usage } = await llm.generateStructured<{
      hypotheses: Hypothesis[]
      judgments: Judgment[]
    }>({
      system: systemPrompt(analysis?.persona ?? '', domain),
      user,
      schema: SCHEMA as object,
      maxTokens: 4200,
      label: 'customer_voice_validate',
      meta,
    })

    const normalized: Hypothesis[] = (Array.isArray(data?.hypotheses) ? data.hypotheses : [])
      .map((h, i) => ({
        id: typeof h?.id === 'string' && h.id.trim() ? h.id.trim() : `h${i + 1}`,
        statement: typeof h?.statement === 'string' ? h.statement.trim() : '',
        category: VALID_CATEGORIES.includes(h?.category) ? h.category : ('problem' as const),
        confidence: clamp01(h?.confidence),
      }))
      .filter((h) => h.statement.length > 0)

    const { hypotheses, remap } = dedupeHypothesesWithIdRemap(normalized)
    const keptIds = new Set(hypotheses.map((h) => h.id))

    const judgments = (Array.isArray(data?.judgments) ? data.judgments : [])
      .filter((j) => j && j.stance !== 'unrelated' && typeof j.unitIndex === 'number')
      .map((j) => ({ ...j, hypothesisId: remap.get(j.hypothesisId) ?? j.hypothesisId }))
      .filter((j) => keptIds.has(j.hypothesisId))

    if (hypotheses.length) return { hypotheses, judgments, usage }
    // Fall through to the synthetic claim when the model returned none.
    return { hypotheses: syntheticHypothesis(analysis, problem), judgments: [], usage }
  } catch {
    return { hypotheses: syntheticHypothesis(analysis, problem), judgments: [] }
  }
}

/** Last-resort single claim from the analysis, so the pipeline still completes. */
function syntheticHypothesis(analysis: DocumentAnalysis | undefined, problem: string): Hypothesis[] {
  if (!problem) return []
  return [
    {
      id: 'h1',
      statement: problem,
      category: 'problem',
      confidence: clamp01(analysis?.confidence ?? 0.5),
    },
  ]
}
