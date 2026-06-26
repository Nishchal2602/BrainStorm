import type { TokenUsage } from '@/lib/types'
import type { LlmPort } from '../../llm'
import type { Claim } from './claims'
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
  claimId: string
  stance: Stance
  quote: string
  relevanceScore: number
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
          claimId: { type: 'string' },
          stance: { type: 'string', enum: ['supports', 'contradicts', 'unrelated'] },
          quote: { type: 'string' },
          relevanceScore: { type: 'number' },
          evidenceStrength: { type: 'number' },
          authorCredibility: { type: 'number' },
          segment: { type: 'string' },
          reasoning: { type: 'string' },
        },
        required: [
          'unitIndex',
          'claimId',
          'stance',
          'quote',
          'relevanceScore',
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

const SYSTEM = `You validate specific claims against individual Reddit units (each unit is one post or one comment). For EACH unit, decide which ONE claim (by id) it most directly addresses, then judge it.

- stance: "supports" (the unit is evidence the claim is TRUE), "contradicts" (evidence it is FALSE / the person does NOT have the problem), or "unrelated" (off-topic, or merely same domain). Same industry/topic is NOT relevance.
- quote: copy a VERBATIM substring from THAT unit's text (exact characters) — never paraphrase or invent. If no verbatim sentence genuinely fits the claim, mark the unit "unrelated".
- relevanceScore 0-10: how directly the unit speaks to the SPECIFIC claim.
- evidenceStrength 0-10: first-hand, specific lived experience (high) vs vague/second-hand (low).
- authorCredibility 0-10: from the author's flair/role signals (practitioner/engineer/PM/founder/manager). ~5 if unknown.
- segment: the author's role/segment if evident (e.g. "Software Engineer", "Product Manager", "Founder", "Marketer"); else "".
You MAY omit units that are clearly unrelated. Be strict: precision over coverage.`

function renderUnits(units: DiscussionUnit[]): string {
  return units
    .map((u, i) => {
      const who = u.author ? `by ${u.author}${u.authorFlair ? ` [${u.authorFlair}]` : ''}` : ''
      return `[${i}] r/${u.subreddit} (▲${u.score}) ${who}\n${u.text}`
    })
    .join('\n\n')
}

/** Step 3: comment-level verification — one structured call over all units × claims. */
export async function verifyEvidence(
  llm: LlmPort,
  claims: Claim[],
  units: DiscussionUnit[],
  meta?: { clientId?: string },
): Promise<{ judgments: Judgment[]; usage?: TokenUsage }> {
  if (!claims.length || !units.length) return { judgments: [] }
  const claimList = claims.map((c) => `${c.id}: ${c.claim}`).join('\n')
  const user = `CLAIMS:\n${claimList}\n\nUNITS:\n${renderUnits(units)}`

  const { data, usage } = await llm.generateStructured<{ judgments: Judgment[] }>({
    system: SYSTEM,
    user,
    schema: SCHEMA as object,
    maxTokens: 3500,
    label: 'customer_voice_verify',
    meta,
  })
  const judgments = (Array.isArray(data?.judgments) ? data.judgments : []).filter(
    (j) => j && j.stance !== 'unrelated' && typeof j.unitIndex === 'number',
  )
  return { judgments, usage }
}
