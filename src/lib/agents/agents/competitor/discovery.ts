import type { SourceRef, TokenUsage } from '@/lib/types'
import { cleanBullet } from '@/lib/features/parse'
import type { DocumentAnalysis } from '../../types'
import type { LlmPort } from '../../llm'

const MAX_QUERIES = 8
const MAX_USES = 8
const MAX_TOKENS = 6000

/** Raw, pre-normalization shapes parsed from the grounded template. */
export interface RawCapability {
  name: string
  url?: string
  quote?: string
}
export interface RawCompetitor {
  name: string
  url?: string
  relationship?: string
  match?: number
  positioning?: string
  jobApproach?: string
  targetCustomer?: string
  pricing?: string
  strengths: string[]
  weaknesses: string[]
  capabilities: RawCapability[]
}
export interface RawLandscape {
  jobs: string[]
  competitors: RawCompetitor[]
}

const clean = (s: string): string => s.trim().replace(/\s+/g, ' ')
const UNKNOWN = (s: string | undefined): boolean => !s || s.trim().toLowerCase() === 'unknown'

/**
 * Problem-first queries (#1): describe the customer problem/job, NOT the tech
 * capabilities — so we find products that solve the same job differently, not just
 * products with matching technology. Capabilities are compared AFTER discovery.
 */
export function buildProblemQueries(analysis: DocumentAnalysis | undefined): string[] {
  const a = analysis
  const persona = a?.persona?.trim()
  const cat = a?.productCategory
  const sol = a?.solutionCategory
  const out: string[] = []
  if (a?.coreProblem) out.push(clean(a.coreProblem))
  if (!UNKNOWN(sol)) {
    out.push(clean(sol!))
    if (persona) out.push(`${clean(sol!)} for ${persona}`)
  }
  if (!UNKNOWN(cat)) {
    out.push(`${clean(cat!)} software`)
    if (persona) out.push(`${clean(cat!)} for ${persona}`)
  }
  for (const syn of a?.synonyms ?? []) out.push(clean(syn))

  const seen = new Set<string>()
  const deduped: string[] = []
  for (const q of out) {
    const k = q.toLowerCase()
    if (q.length < 3 || seen.has(k)) continue
    seen.add(k)
    deduped.push(q)
    if (deduped.length >= MAX_QUERIES) break
  }
  return deduped
}

const SYSTEM = `You are a product manager doing competitive research with web search. Identify who already solves the SAME CUSTOMER JOB as the product described, using ONLY real results from your web search — never invent products, URLs, capabilities, or quotes.

First state the core customer job(s) in plain language. Then list real products that address that job — DIRECT (same job, same approach), INDIRECT (same job, different/broader approach), and ADJACENT (related space). Output STRICT plain text in EXACTLY this format, nothing else:

## JOB: <core customer job in plain language>
## COMPETITOR: <product name>
URL: <real product url> | RELATIONSHIP: direct|indirect|adjacent | MATCH: <0-100 how sure this is a real product for this job> | TARGET: <customer> | PRICING: <if obvious, else ->
POSITIONING: <one line> | JOB_APPROACH: <how it solves the job>
STRENGTHS: <comma-separated> | WEAKNESSES: <comma-separated>
CAP: <capability name> | URL: <real url documenting it> | QUOTE: <short verbatim phrase from that page>
CAP: <capability name> | URL: <real url> | QUOTE: <short verbatim phrase>
## COMPETITOR: <next product>
...

Rules: at most ~10 competitors, at most 5 CAP lines each. Every CAP must have a real URL and a short verbatim QUOTE — omit any capability you cannot ground. If you cannot find real competitors, output exactly: NO COMPETITORS FOUND.`

/** One " | "-delimited line → { LABEL: value } map (labels are fixed uppercase tokens). */
function fields(line: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const seg of line.split(/\s+\|\s+/)) {
    const m = seg.match(/^([A-Z_]+):\s*([\s\S]*)$/)
    if (m) out[m[1].toUpperCase()] = m[2].trim()
  }
  return out
}

const splitList = (s: string | undefined): string[] =>
  (s ?? '')
    .split(/[,;]/)
    .map((x) => clean(x))
    .filter((x) => x && x !== '-')

function parseCapLine(line: string): RawCapability | null {
  // QUOTE is last + free-text — capture it wholesale, parse labels from the head.
  const qm = line.match(/(?:^|\s\|\s)QUOTE:\s*([\s\S]*)$/i)
  const quote = qm ? clean(qm[1]).replace(/^["'“”]+|["'“”]+$/g, '') : undefined
  const head = qm ? line.slice(0, qm.index) : line
  const f = fields(head)
  const name = clean(f.CAP || '')
  if (!name) return null
  return { name, url: f.URL || undefined, quote: quote || undefined }
}

/** Pure parser for the grounded landscape template. Tolerant of missing sections. */
export function parseLandscape(raw: string): RawLandscape {
  const empty: RawLandscape = { jobs: [], competitors: [] }
  if (!raw || /no competitors found/i.test(raw)) return empty

  const jobs: string[] = []
  const competitors: RawCompetitor[] = []
  let cur: RawCompetitor | null = null
  const flush = () => {
    if (cur && cur.name) competitors.push(cur)
    cur = null
  }

  for (const rawLine of raw.split('\n')) {
    const line = cleanBullet(rawLine).trim()
    if (!line) continue

    const job = line.match(/^##\s*JOB:\s*(.*)$/i)
    if (job) {
      const j = clean(job[1])
      if (j) jobs.push(j)
      continue
    }
    const comp = line.match(/^##\s*COMPETITOR:\s*(.*)$/i)
    if (comp) {
      flush()
      cur = {
        name: clean(comp[1]),
        strengths: [],
        weaknesses: [],
        capabilities: [],
      }
      continue
    }
    if (!cur) continue

    if (/^CAP:/i.test(line)) {
      const cap = parseCapLine(line)
      if (cap) cur.capabilities.push(cap)
      continue
    }
    const f = fields(line)
    if (f.URL && !cur.url) cur.url = f.URL
    if (f.RELATIONSHIP) cur.relationship = f.RELATIONSHIP.toLowerCase()
    if (f.MATCH) {
      const n = Number(f.MATCH.replace(/[^0-9.]/g, ''))
      if (Number.isFinite(n)) cur.match = n
    }
    if (f.TARGET && f.TARGET !== '-') cur.targetCustomer = f.TARGET
    if (f.PRICING && f.PRICING !== '-') cur.pricing = f.PRICING
    if (f.POSITIONING) cur.positioning = f.POSITIONING
    if (f.JOB_APPROACH) cur.jobApproach = f.JOB_APPROACH
    if (f.STRENGTHS) cur.strengths = splitList(f.STRENGTHS)
    if (f.WEAKNESSES) cur.weaknesses = splitList(f.WEAKNESSES)
  }
  flush()

  return { jobs, competitors }
}

/** Step 2: one grounded web-search call → parsed raw landscape (+ sources/usage). */
export async function discoverLandscape(
  llm: LlmPort,
  queries: string[],
  meta?: { clientId?: string },
): Promise<{ raw: RawLandscape; sources: SourceRef[]; usage?: TokenUsage }> {
  if (!queries.length) return { raw: { jobs: [], competitors: [] }, sources: [] }
  const user = `Find products that solve the same customer job behind these searches:\n${queries.map((q) => `- ${q}`).join('\n')}`
  const { text, sources, usage } = await llm.generateText({
    system: SYSTEM,
    user,
    webSearch: { maxUses: MAX_USES },
    maxTokens: MAX_TOKENS,
    label: 'competitor_discovery',
    meta,
  })
  return { raw: parseLandscape(text), sources, usage }
}
