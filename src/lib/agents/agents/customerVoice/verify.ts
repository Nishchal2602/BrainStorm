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

/**
 * Hard cap on what enters the (single) validation prompt. Preserves relevance
 * (docs arrive relevance-sorted; a doc's post precedes its comments) while
 * spreading coverage across threads: round-robin one unit per doc, upvotes
 * deciding order within a doc, until `max` is reached.
 */
export function selectTopUnitsForValidation(units: DiscussionUnit[], max = 24): DiscussionUnit[] {
  if (units.length <= max) return units
  // Group by doc, preserving doc order (= relevance order).
  const byDoc = new Map<number, DiscussionUnit[]>()
  for (const u of units) {
    const arr = byDoc.get(u.docIndex) ?? []
    arr.push(u)
    byDoc.set(u.docIndex, arr)
  }
  // Within a doc: post first, then comments by upvotes.
  for (const arr of byDoc.values()) {
    arr.sort((a, b) => {
      if (a.unitId === 'post') return -1
      if (b.unitId === 'post') return 1
      return b.score - a.score
    })
  }
  const groups = [...byDoc.values()]
  const out: DiscussionUnit[] = []
  for (let round = 0; out.length < max; round++) {
    let added = false
    for (const g of groups) {
      if (round < g.length && out.length < max) {
        out.push(g[round])
        added = true
      }
    }
    if (!added) break
  }
  return out
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
  /** Legacy-optional: never read by scoring; no longer requested from the model. */
  reasoning?: string
}
