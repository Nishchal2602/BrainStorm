import type { TokenUsage } from '@/lib/types'
import type { DocumentAnalysis } from '../../types'
import type { LlmPort } from '../../llm'
import type { Hypothesis } from './hypothesis'
import type { DiscussionDoc, DiscussionUnit } from './types'

const MAX_UNITS = 40
const UNIT_CAP = 250

/** Flatten docs into quotable units: the post (title+body) and each comment.
 * docs are already relevance-sorted, so we fill units in priority order. */
export function buildUnits(docs: DiscussionDoc[]): DiscussionUnit[] {
  const units: DiscussionUnit[] = []
  for (let d = 0; d < docs.length && units.length < MAX_UNITS; d++) {
    const doc = docs[d]
    const postText = `${doc.title}\n${doc.body}`.trim()
    if (postText) {
      units.push({
        docIndex: d,
        unitId: 'post',
        text: postText.slice(0, UNIT_CAP),
        score: doc.score,
        author: doc.author,
        authorFlair: doc.authorFlair,
        subreddit: doc.subreddit,
        url: doc.url,
      })
    }
    for (let i = 0; i < doc.comments.length && units.length < MAX_UNITS; i++) {
      const c = doc.comments[i]
      units.push({
        docIndex: d,
        unitId: `c${i}`,
        text: c.body.slice(0, UNIT_CAP),
        score: c.score,
        author: c.author,
        authorFlair: c.authorFlair,
        subreddit: doc.subreddit,
        url: doc.url,
      })
    }
  }
  return units
}

export type Stance = 'supports' | 'contradicts' | 'unrelated'

export interface Judgment {
  unitIndex: number
  hypothesisId: string
  stance: Stance
  quote: string
  /** How directly the unit speaks to THIS hypothesis's problem (0-10). */
  problemMatch: number
  /** How well the author matches the target persona (0-10). */
  personaMatch: number
  /** Same product/domain as the hypothesis (0-10) — guards cross-domain merges. */
  productMatch: number
  evidenceStrength: number
  authorCredibility: number
  segment: string
  reasoning: string
}

// Gemini responseSchema is an OpenAPI subset — no `additionalProperties`.
const SCHEMA = {
  type: 'object',
  properties: {
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
          reasoning: { type: 'string' },
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
          'reasoning',
        ],
      },
    },
  },
  required: ['judgments'],
} as const

function systemPrompt(persona: string, domain: string): string {
  return `You validate specific hypotheses against individual Reddit units (each unit is one post or one comment). For EACH unit, decide which ONE hypothesis (by id) it most directly addresses, then judge it.

${persona ? `Target persona: ${persona}\n` : ''}${domain ? `Product domain: ${domain}\n` : ''}
- stance: "supports" (the unit is evidence the hypothesis is TRUE), "contradicts" (evidence it is FALSE / the person does NOT have the problem), or "unrelated" (off-topic, or merely same broad topic). Same industry/topic is NOT relevance.
- quote: copy a VERBATIM substring from THAT unit's text (exact characters) — never paraphrase or invent. If no verbatim sentence genuinely fits, mark the unit "unrelated".
- problemMatch 0-10: how directly the unit describes the SPECIFIC problem in the hypothesis (not just the same area).
- personaMatch 0-10: how well the author looks like the target persona/role above (use flair/role signals; ~5 if unknown, lower if clearly a different audience).
- productMatch 0-10: whether it concerns the SAME product/domain above. A different domain (e.g. crypto onboarding vs bank onboarding vs university onboarding) scores LOW even if the wording is similar.
- evidenceStrength 0-10: first-hand, specific lived experience (high) vs vague/second-hand (low).
- authorCredibility 0-10: from the author's flair/role signals (practitioner/engineer/PM/founder/manager). ~5 if unknown.
- segment: the author's role/segment if evident (e.g. "Software Engineer", "Product Manager", "Founder", "Marketer"); else "".
You MAY omit units that are clearly unrelated. Be strict: precision over coverage.`
}

function renderUnits(units: DiscussionUnit[]): string {
  return units
    .map((u, i) => {
      const who = u.author ? `by ${u.author}${u.authorFlair ? ` [${u.authorFlair}]` : ''}` : ''
      return `[${i}] r/${u.subreddit} (▲${u.score}) ${who}\n${u.text}`
    })
    .join('\n\n')
}

/** Step 4: comment-level verification with multi-dimensional relevance —
 * one structured call over all units × hypotheses. */
export async function verifyEvidence(
  llm: LlmPort,
  hypotheses: Hypothesis[],
  units: DiscussionUnit[],
  analysis?: DocumentAnalysis,
  meta?: { clientId?: string },
): Promise<{ judgments: Judgment[]; usage?: TokenUsage }> {
  if (!hypotheses.length || !units.length) return { judgments: [] }
  const list = hypotheses.map((h) => `${h.id}: ${h.statement}`).join('\n')
  const domain = [analysis?.productCategory, analysis?.industry].filter(Boolean).join(' · ')
  const user = `HYPOTHESES:\n${list}\n\nUNITS:\n${renderUnits(units)}`

  const { data, usage } = await llm.generateStructured<{ judgments: Judgment[] }>({
    system: systemPrompt(analysis?.persona ?? '', domain),
    user,
    schema: SCHEMA as object,
    maxTokens: 3800,
    label: 'customer_voice_verify',
    meta,
  })
  const judgments = (Array.isArray(data?.judgments) ? data.judgments : []).filter(
    (j) => j && j.stance !== 'unrelated' && typeof j.unitIndex === 'number',
  )
  return { judgments, usage }
}
