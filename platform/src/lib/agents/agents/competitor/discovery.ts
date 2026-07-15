import type { SourceRef, TokenUsage } from '@/lib/types'
import { cleanBullet } from '@/lib/features/parse'
import type {
  CompetitorRelationship,
  DifferentiationScores,
  DocumentAnalysis,
  MarketSegment,
  ProposalProfile,
  StrategicWhiteSpace,
} from '../../types'
import type { LlmPort } from '../../llm'
import { compactContext } from '../shared'

const MAX_QUERIES = 8
const MAX_USES = 8
const MAX_TOKENS = 6500

/** Raw, pre-normalization shapes parsed from the grounded facts template. */
export interface RawCapability {
  name: string
  url?: string
  quote?: string
}
export interface RawCompetitor {
  name: string
  url?: string
  category?: string
  primaryJob?: string
  positioning?: string
  architecture?: string
  targetCustomer?: string
  match?: number
  strengths: string[]
  weaknesses: string[]
  capabilities: RawCapability[]
}
export interface RawLandscape {
  competitors: RawCompetitor[]
}

// --- Market reasoning shapes (moved from the deleted reasoning.ts — the merged
// grounded call now produces these from the same response text). ---
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

const clean = (s: string): string => s.trim().replace(/\s+/g, ' ')
const UNKNOWN = (s: string | undefined): boolean => !s || s.trim().toLowerCase() === 'unknown'

/**
 * Problem-first queries (#1): describe the customer problem/job, NOT the tech
 * capabilities — so we find products that solve the same job differently, not just
 * products with matching technology.
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

export const COMPETITOR_SYSTEM = `You are a senior product manager doing competitive research with web search, in ONE pass: first DISCOVER the real products that solve the SAME CUSTOMER JOB as the proposal, then REASON about the market like a strategy consultant. Use ONLY real results from your web search — never invent products, URLs, capabilities, or quotes.

PART 1 — DISCOVERED COMPETITORS. Understand each competitor as Job → Positioning → Architecture → Capabilities (NOT capabilities first). Output STRICT plain text in EXACTLY this format:

## COMPETITOR: <product name>
URL: <real product url> | CATEGORY: <market category, e.g. Enterprise Search, Enterprise AI Assistant, Workflow Automation> | PRIMARY_JOB: <the main job customers hire it for — never just "AI"> | TARGET: <customer> | MATCH: <0-100 how sure this is a real product for this job>
POSITIONING: <one sentence on how it positions itself> | ARCHITECTURE: <one sentence on how it fundamentally works, e.g. "RAG over enterprise knowledge", "knowledge graph", "workflow automation", "agent orchestration">
STRENGTHS: <comma-separated> | WEAKNESSES: <comma-separated>
CAP: <real product capability> | URL: <real url documenting it> | QUOTE: <short verbatim phrase from that page>
CAP: ...
## COMPETITOR: <next product>

Rules: at most ~10 competitors, at most 5 CAP lines each. CAP must be a real product capability with a real URL and verbatim QUOTE — NEVER a marketing slogan ("best for X", "trusted by", "enterprise-ready", "fast"). Omit any capability you cannot ground. If you cannot find real competitors, output exactly: NO COMPETITORS FOUND (and skip Part 2).

PART 2 — MARKET ANALYSIS. Treat the competitors above as verified facts and reason positioning-over-features. Output EXACTLY:

## MARKET
PROPOSAL: CATEGORY: <the proposal's market category> | JOB: <its primary customer job> | ARCH: <how it fundamentally works> | POSITIONING: <its value proposition in one sentence>
MARKET_CATEGORY: <name of this market> | MATURITY: <Low|Medium|High — how established the category is>
SEGMENT: <segment name>: <competitor 1>, <competitor 2>
REL: <competitor name> | <direct|adjacent|substitute> | <one-line reason>
SCORES: overlap=<0-100 how crowded the same-job space is> | architecture=<0-100 how different the proposal's approach is> | capability=<0-100 how uncommon its planned capabilities are> | positioning=<0-100 how different its value proposition is>
RECOMMENDATION: <2-4 sentences a PM could paste into a strategy doc — name the market, the crowding, and where real differentiation lies>

## WHITESPACE
- <strategic positioning the proposal could own> :: <rationale naming which discovered competitors lack it — never "nobody does this">

## INSIGHT
- <market_insight|risk|opportunity> :: <statement grounded in the competitors above>

Rules: one SEGMENT line per cluster; one REL line per competitor ("direct" = same job, same approach, same customer — do NOT call everything direct); 2-4 WHITESPACE lines, each justified by the ABSENCE of that positioning among the discovered competitors; 3-5 INSIGHT lines. Base everything ONLY on the proposal + the competitors you found.`

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
  const qm = line.match(/(?:^|\s\|\s)QUOTE:\s*([\s\S]*)$/i)
  const quote = qm ? clean(qm[1]).replace(/^["'“”]+|["'“”]+$/g, '') : undefined
  const head = qm ? line.slice(0, qm.index) : line
  const f = fields(head)
  const name = clean(f.CAP || '')
  if (!name) return null
  return { name, url: f.URL || undefined, quote: quote || undefined }
}

/** Pure parser for the grounded facts template. Tolerant of missing fields. */
export function parseLandscape(raw: string): RawLandscape {
  if (!raw || /no competitors found/i.test(raw)) return { competitors: [] }

  const competitors: RawCompetitor[] = []
  let cur: RawCompetitor | null = null
  const flush = () => {
    if (cur && cur.name) competitors.push(cur)
    cur = null
  }

  for (const rawLine of raw.split('\n')) {
    const line = cleanBullet(rawLine).trim()
    if (!line) continue

    const comp = line.match(/^##\s*COMPETITOR:\s*(.*)$/i)
    if (comp) {
      flush()
      cur = { name: clean(comp[1]), strengths: [], weaknesses: [], capabilities: [] }
      continue
    }
    // Any other section header ends competitor parsing state.
    if (/^##\s/.test(line)) {
      flush()
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
    if (f.CATEGORY) cur.category = f.CATEGORY
    if (f.PRIMARY_JOB) cur.primaryJob = f.PRIMARY_JOB
    if (f.TARGET && f.TARGET !== '-') cur.targetCustomer = f.TARGET
    if (f.MATCH) {
      const n = Number(f.MATCH.replace(/[^0-9.]/g, ''))
      if (Number.isFinite(n)) cur.match = n
    }
    if (f.POSITIONING) cur.positioning = f.POSITIONING
    if (f.ARCHITECTURE) cur.architecture = f.ARCHITECTURE
    if (f.STRENGTHS) cur.strengths = splitList(f.STRENGTHS)
    if (f.WEAKNESSES) cur.weaknesses = splitList(f.WEAKNESSES)
  }
  flush()

  return { competitors }
}

// --- Market-reasoning parser (tolerant; null → caller uses pure fallback) ---

const clamp100 = (n: number): number => Math.min(100, Math.max(0, Math.round(n)))

/** Score values arrive as "70", "70/100", "~70", or words ("High"). */
function scoreValue(s: string | undefined): number | null {
  if (!s) return null
  const digits = s.match(/\d+(?:\.\d+)?/)
  if (digits) return clamp100(Number(digits[0]))
  const w = s.toLowerCase()
  if (w.includes('high')) return 80
  if (w.includes('med')) return 55
  if (w.includes('low')) return 30
  return null
}

function relValue(s: string): CompetitorRelationship | null {
  const w = s.toLowerCase()
  if (w.includes('direct')) return 'direct'
  if (w.includes('adjacent')) return 'adjacent'
  if (w.includes('subst')) return 'substitute'
  return null
}

function insightType(s: string): MarketInsight['type'] {
  const w = s.toLowerCase()
  if (w.includes('risk')) return 'risk'
  if (w.includes('opportun')) return 'opportunity'
  return 'market_insight'
}

/** Parse the ## MARKET / ## WHITESPACE / ## INSIGHT sections into a ReasoningResult.
 * Returns null when the reasoning portion is missing/malformed (missing MARKET or
 * SCORES) — the caller then falls back to pure reasoning; competitors are kept. */
export function parseMarketReasoning(raw: string): ReasoningResult | null {
  const start = raw.search(/^##\s*MARKET\b/im)
  if (start < 0) return null
  const text = raw.slice(start)

  const proposal: ProposalProfile = { category: '', primaryJob: '', architecture: '', positioning: '' }
  let marketCategory = ''
  let marketMaturity: ReasoningResult['marketMaturity'] = 'Medium'
  const segments: MarketSegment[] = []
  const relationships: RelationshipCall[] = []
  const whiteSpace: StrategicWhiteSpace[] = []
  const insights: MarketInsight[] = []
  let scores: DifferentiationScores | null = null
  let recommendation = ''

  let section: 'market' | 'whitespace' | 'insight' | null = null
  for (const rawLine of text.split('\n')) {
    const line = cleanBullet(rawLine).trim()
    if (!line) continue

    const header = line.match(/^##\s*(\w+)/)
    if (header) {
      const h = header[1].toLowerCase()
      section = h === 'market' ? 'market' : h === 'whitespace' ? 'whitespace' : h === 'insight' ? 'insight' : null
      continue
    }

    if (section === 'market') {
      if (/^PROPOSAL:/i.test(line)) {
        const f = fields(line.replace(/^PROPOSAL:\s*/i, ''))
        proposal.category = f.CATEGORY || proposal.category
        proposal.primaryJob = f.JOB || f.PRIMARY_JOB || proposal.primaryJob
        proposal.architecture = f.ARCH || f.ARCHITECTURE || proposal.architecture
        proposal.positioning = f.POSITIONING || proposal.positioning
        continue
      }
      const seg = line.match(/^SEGMENT:\s*([^:]+):\s*(.*)$/i)
      if (seg) {
        const competitors = splitList(seg[2])
        if (competitors.length) segments.push({ name: clean(seg[1]), competitors })
        continue
      }
      const rel = line.match(/^REL:\s*(.*)$/i)
      if (rel) {
        const parts = rel[1].split('|').map((p) => p.trim())
        const relationship = parts[1] ? relValue(parts[1]) : null
        if (parts[0] && relationship) {
          relationships.push({ competitor: parts[0], relationship, reason: parts[2] ?? '' })
        }
        continue
      }
      if (/^SCORES:/i.test(line)) {
        const kv: Record<string, string> = {}
        for (const m of line.replace(/^SCORES:\s*/i, '').matchAll(/(\w+)\s*=\s*([^|]+)/g)) {
          kv[m[1].toLowerCase()] = m[2].trim()
        }
        const overlap = scoreValue(kv.overlap)
        const architecture = scoreValue(kv.architecture)
        const capability = scoreValue(kv.capability)
        const positioning = scoreValue(kv.positioning)
        if (overlap != null && architecture != null && capability != null && positioning != null) {
          scores = {
            marketOverlap: overlap,
            architectureNovelty: architecture,
            capabilityDifferentiation: capability,
            positioningDifferentiation: positioning,
          }
        }
        continue
      }
      const rec = line.match(/^RECOMMENDATION:\s*(.*)$/i)
      if (rec) {
        recommendation = clean(rec[1])
        continue
      }
      const mkt = fields(line)
      if (mkt.MARKET_CATEGORY) marketCategory = mkt.MARKET_CATEGORY
      if (mkt.MATURITY) {
        const w = mkt.MATURITY.toLowerCase()
        marketMaturity = w.startsWith('l') ? 'Low' : w.startsWith('h') ? 'High' : 'Medium'
      }
      // Unlabeled prose right after RECOMMENDATION → continuation.
      if (recommendation && !/^[A-Z_]+:/.test(line) && Object.keys(mkt).length === 0) {
        recommendation = `${recommendation} ${clean(line)}`
      }
      continue
    }

    if (section === 'whitespace') {
      const [opportunity, rationale] = line.split(/\s*::\s*/)
      if (opportunity) whiteSpace.push({ opportunity: clean(opportunity), rationale: rationale ? clean(rationale) : undefined })
      continue
    }

    if (section === 'insight') {
      const [t, statement] = line.split(/\s*::\s*/)
      if (statement) insights.push({ type: insightType(t), statement: clean(statement) })
      else if (t) insights.push({ type: 'market_insight', statement: clean(t) })
      continue
    }
  }

  // Reasoning is only usable with scores + some proposal signal.
  if (!scores || (!proposal.category && !proposal.primaryJob)) return null

  return {
    proposal,
    marketCategory,
    marketMaturity,
    segments,
    relationships,
    whiteSpace: whiteSpace.slice(0, 4),
    scores,
    recommendation,
    insights: insights.slice(0, 6),
  }
}

/** THE one Competitor call: grounded discovery + market reasoning in a single
 * web-search pass (jsonSchema+webSearch are mutually exclusive, so the reasoning
 * comes back in the same parseable text template). */
export async function discoverAndReason(
  llm: LlmPort,
  analysis: DocumentAnalysis | undefined,
  queries: string[],
  meta?: { clientId?: string },
): Promise<{ raw: RawLandscape; reasoning: ReasoningResult | null; rawText: string; sources: SourceRef[]; usage?: TokenUsage }> {
  if (!queries.length) return { raw: { competitors: [] }, reasoning: null, rawText: '', sources: [] }
  const context = compactContext(analysis)
  const user = [
    context,
    `Find products that solve the same customer job behind these searches, then produce the market analysis:\n${queries.map((q) => `- ${q}`).join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const { text, sources, usage } = await llm.generateText({
    system: COMPETITOR_SYSTEM,
    user,
    webSearch: { maxUses: MAX_USES },
    maxTokens: MAX_TOKENS,
    label: 'competitor_discover_reason',
    meta,
  })
  return { raw: parseLandscape(text), reasoning: parseMarketReasoning(text), rawText: text, sources, usage }
}
