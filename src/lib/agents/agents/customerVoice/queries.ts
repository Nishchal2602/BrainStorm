import type { DocumentAnalysis } from '../../types'

const MAX_QUERIES = 6

/**
 * Build the search queries for retrieval from the shared DocumentAnalysis.
 * Pure + deterministic: prefer the analysis's searchQueries, fall back to
 * synonyms / coreProblem, dedup (case-insensitive), drop blanks, cap.
 */
export function buildQueries(analysis: DocumentAnalysis | undefined): string[] {
  const candidates = [
    ...(analysis?.searchQueries ?? []),
    ...(analysis?.synonyms ?? []),
    analysis?.coreProblem ?? '',
  ]
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of candidates) {
    const q = raw.trim()
    if (!q) continue
    const key = q.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(q)
    if (out.length >= MAX_QUERIES) break
  }
  return out
}
