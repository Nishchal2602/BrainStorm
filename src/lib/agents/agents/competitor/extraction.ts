import type {
  Competitor,
  CompetitorCapability,
  CompetitorRelationship,
  CustomerJob,
  DocumentAnalysis,
} from '../../types'
import type { RawCompetitor, RawLandscape } from './discovery'

/** Competitors below this confidence are dropped (anti-hallucination, #2). */
const MIN_CONFIDENCE = 60
const MAX_CAPS = 5

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : 0))
const clean = (s: string): string => s.trim().replace(/\s+/g, ' ')

const titleCase = (s: string): string =>
  clean(s).replace(/\b\w/g, (m) => m.toUpperCase())

// Collapse synonymous capability names to a canonical label (#5 white-space needs stable names).
const CANON: { match: RegExp; canonical: string }[] = [
  { match: /company context|enterprise context|internal knowledge|org(anizational)? context|business context/i, canonical: 'Enterprise Context' },
  { match: /enterprise search|company search|workplace search|internal search/i, canonical: 'Enterprise Search' },
  { match: /role[- ]?aware|role awareness|persona[- ]?aware/i, canonical: 'Role Awareness' },
  { match: /\brag\b|retrieval[- ]?augmented/i, canonical: 'RAG' },
  { match: /knowledge graph/i, canonical: 'Knowledge Graph' },
  { match: /permission|access control|\bacl\b/i, canonical: 'Permission Awareness' },
  { match: /document index|doc index|indexing/i, canonical: 'Document Indexing' },
  { match: /chat|conversational|assistant interface/i, canonical: 'Chat Interface' },
  { match: /integration|connector/i, canonical: 'Integrations' },
  { match: /memory|long[- ]?term context/i, canonical: 'Memory' },
]

/** Canonicalize a capability name so synonyms roll up to one matrix row. */
export function normalizeCapability(name: string): string {
  const n = clean(name)
  for (const c of CANON) if (c.match.test(n)) return c.canonical
  return titleCase(n)
}

const isHttpUrl = (u: string | undefined): boolean => !!u && /^https?:\/\/\S+\.\S+/.test(u.trim())

function relationshipOf(raw: string | undefined): CompetitorRelationship {
  const r = (raw || '').toLowerCase()
  if (r.startsWith('direct')) return 'direct'
  if (r.startsWith('adjacent')) return 'adjacent'
  return 'indirect'
}

/** Evidence-bound capabilities only — drop any without a real URL + quote (#3/#4). */
function keepCapabilities(raw: RawCompetitor): CompetitorCapability[] {
  const seen = new Set<string>()
  const out: CompetitorCapability[] = []
  for (const c of raw.capabilities) {
    if (!isHttpUrl(c.url) || !c.quote || c.quote.length < 4) continue
    const name = normalizeCapability(c.name)
    const k = name.toLowerCase()
    if (!name || seen.has(k)) continue
    seen.add(k)
    out.push({ name, evidence: { url: c.url, quote: clean(c.quote) } })
    if (out.length >= MAX_CAPS) break
  }
  return out
}

/** Confidence 0–100 from grounding signals (#2). Model self-rating is the base; real URL
 * and evidence-bound capabilities raise it; a bare name with no positioning lowers it. */
function confidenceOf(raw: RawCompetitor, caps: CompetitorCapability[]): number {
  let conf = raw.match != null ? clamp(raw.match, 0, 100) : 50
  if (isHttpUrl(raw.url)) conf += 12
  if (caps.length >= 1) conf += 12
  if (raw.relationship) conf += 4
  if (!raw.positioning) conf -= 8
  return Math.round(clamp(conf, 0, 100))
}

export interface NormalizedLandscape {
  competitors: Competitor[]
  jobs: CustomerJob[]
  droppedLowConfidence: number
}

/** Step 3 (PURE): dedup, canonicalize, score confidence, drop low-confidence/no-evidence. */
export function normalizeLandscape(
  raw: RawLandscape,
  analysis: DocumentAnalysis | undefined,
): NormalizedLandscape {
  const byKey = new Map<string, Competitor>()
  let dropped = 0

  for (const rc of raw.competitors) {
    const name = clean(rc.name)
    if (!name) continue
    const caps = keepCapabilities(rc)
    const confidence = confidenceOf(rc, caps)
    if (confidence < MIN_CONFIDENCE) {
      dropped++
      continue
    }
    const key = name.toLowerCase()
    if (byKey.has(key)) continue // dedup by name
    byKey.set(key, {
      name,
      url: isHttpUrl(rc.url) ? rc.url!.trim() : '',
      positioning: rc.positioning ? clean(rc.positioning) : '',
      relationship: relationshipOf(rc.relationship),
      confidence,
      jobApproach: rc.jobApproach ? clean(rc.jobApproach) : undefined,
      targetCustomer: rc.targetCustomer ? clean(rc.targetCustomer) : undefined,
      capabilities: caps,
      strengths: rc.strengths.map(clean).filter(Boolean).slice(0, 6),
      weaknesses: rc.weaknesses.map(clean).filter(Boolean).slice(0, 6),
    })
  }

  const competitors = [...byKey.values()].sort((a, b) => b.confidence - a.confidence)

  // Jobs-to-be-done (#10): primary job carries each competitor's approach.
  const jobStrings = raw.jobs.length
    ? raw.jobs.map(clean).filter(Boolean)
    : analysis?.coreProblem
      ? [clean(analysis.coreProblem)]
      : []
  const approaches = competitors
    .filter((c) => c.jobApproach)
    .map((c) => ({ competitor: c.name, approach: c.jobApproach as string }))
  const jobs: CustomerJob[] = jobStrings.map((job, i) => ({
    job,
    approaches: i === 0 ? approaches : [],
  }))

  return { competitors, jobs, droppedLowConfidence: dropped }
}
