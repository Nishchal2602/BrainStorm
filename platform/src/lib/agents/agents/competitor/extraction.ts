import type { Competitor, CompetitorCapability } from '../../types'
import type { RawCompetitor, RawLandscape } from './discovery'

/** Competitors below this confidence are dropped (anti-hallucination). */
const MIN_CONFIDENCE = 60
const MAX_CAPS = 6

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : 0))
const clean = (s: string): string => s.trim().replace(/\s+/g, ' ')
const titleCase = (s: string): string => clean(s).replace(/\b\w/g, (m) => m.toUpperCase())
const isHttpUrl = (u: string | undefined): boolean => !!u && /^https?:\/\/\S+\.\S+/.test(u.trim())

// A primaryJob this generic is not a real job-to-be-done; drop it so the canonical
// category is shown instead (the "never just AI" guarantee, enforced structurally).
const GENERIC_JOB_RE = /^(ai|a\.?i\.?|artificial intelligence|ai (assistant|tool|tooling|platform|app|software|chatbot|agent|agents))$/i
const realJob = (s: string | undefined): string => {
  const j = clean(s ?? '')
  return GENERIC_JOB_RE.test(j) ? '' : j
}

// Marketing slogans masquerading as capabilities — never a real product capability.
const MARKETING_RE =
  /\b(best for|trusted by|fortune\s*500|enterprise[-\s]?ready|general productivity|easy to use|fast|scalable|secure|industry[-\s]?leading|all[-\s]?in[-\s]?one|powerful|seamless|cutting[-\s]?edge|world[-\s]?class|google workspace|microsoft\s*365|office\s*365)\b/i

// Canonical capability names so synonyms roll up to one row.
const CAP_CANON: { match: RegExp; canonical: string }[] = [
  { match: /company context|enterprise context|internal knowledge|knowledge base|org(anizational)? context|business context/i, canonical: 'Enterprise Context' },
  { match: /enterprise search|company search|workplace search|internal search|semantic search/i, canonical: 'Enterprise Search' },
  { match: /role[-\s]?aware|role awareness|persona[-\s]?aware|department[-\s]?aware/i, canonical: 'Role Awareness' },
  { match: /\brag\b|retrieval[-\s]?augmented/i, canonical: 'RAG' },
  { match: /knowledge graph|organi[sz]ational graph|company graph/i, canonical: 'Knowledge Graph' },
  { match: /permission|access control|\bacl\b/i, canonical: 'Permission Awareness' },
  { match: /document index|doc index|indexing/i, canonical: 'Document Indexing' },
  { match: /workflow automation|agent automation|task automation/i, canonical: 'Workflow Automation' },
  { match: /chat|conversational/i, canonical: 'AI Chat' },
  { match: /integration|connector/i, canonical: 'Integrations' },
  { match: /memory|long[-\s]?term context|persistent context/i, canonical: 'Memory' },
]

// Canonical market categories.
const CATEGORY_CANON: { match: RegExp; canonical: string }[] = [
  { match: /enterprise search|workplace search/i, canonical: 'Enterprise Search' },
  { match: /enterprise ai assistant|ai assistant|workplace assistant|\bcopilot\b/i, canonical: 'Enterprise AI Assistant' },
  { match: /knowledge management|knowledge base|wiki|knowledge sharing/i, canonical: 'Knowledge Management' },
  { match: /workflow automation|process automation|it automation|itsm/i, canonical: 'Workflow Automation' },
  { match: /developer|coding|code (assistant|completion)/i, canonical: 'Developer Copilot' },
  { match: /meeting|transcription|notetak/i, canonical: 'Meeting Intelligence' },
  { match: /\bcrm\b|customer relationship/i, canonical: 'CRM' },
]

// Canonical architecture types (how a product fundamentally works).
const ARCH_CANON: { match: RegExp; canonical: string }[] = [
  { match: /\brag\b|retrieval[-\s]?augmented/i, canonical: 'RAG' },
  { match: /knowledge graph|organi[sz]ational graph|company graph/i, canonical: 'Knowledge Graph' },
  { match: /workflow|task automation|agent orchestration|agentic|agents?/i, canonical: 'Workflow / Agent Automation' },
  { match: /enterprise search|semantic search|vector search/i, canonical: 'Enterprise Search' },
  { match: /document retrieval|doc retrieval/i, canonical: 'Document Retrieval' },
  { match: /foundation model|\bllm\b|\bgpt\b|gemini|frontier model/i, canonical: 'LLM Chat' },
]

function canonical(value: string, table: { match: RegExp; canonical: string }[], fallbackChars = 0): string {
  const v = clean(value)
  for (const c of table) if (c.match.test(v)) return c.canonical
  return fallbackChars ? titleCase(v).slice(0, fallbackChars) : titleCase(v)
}

/** Canonicalize a capability name so synonyms roll up to one matrix row. */
export function normalizeCapability(name: string): string {
  return canonical(name, CAP_CANON)
}
export function normalizeCategory(name: string | undefined): string {
  return name ? canonical(name, CATEGORY_CANON) : 'Unknown'
}
export function normalizeArchitecture(name: string | undefined): string {
  return name ? canonical(name, ARCH_CANON, 60) : 'Unknown'
}

/** Evidence-bound, non-marketing capabilities only (#3/#4). */
function keepCapabilities(raw: RawCompetitor): CompetitorCapability[] {
  const seen = new Set<string>()
  const out: CompetitorCapability[] = []
  for (const c of raw.capabilities) {
    if (!isHttpUrl(c.url) || !c.quote || c.quote.length < 4) continue
    if (MARKETING_RE.test(c.name)) continue // marketing slogan, not a capability
    const name = normalizeCapability(c.name)
    const k = name.toLowerCase()
    if (!name || seen.has(k)) continue
    seen.add(k)
    out.push({ name, evidence: { url: c.url, quote: clean(c.quote) } })
    if (out.length >= MAX_CAPS) break
  }
  return out
}

/** Confidence 0–100 from grounding signals. Model self-rating is the base; real URL,
 * evidence-bound capabilities, and a real primaryJob raise it. */
function confidenceOf(raw: RawCompetitor, caps: CompetitorCapability[]): number {
  let conf = raw.match != null ? clamp(raw.match, 0, 100) : 50
  if (isHttpUrl(raw.url)) conf += 12
  if (caps.length >= 1) conf += 12
  if (realJob(raw.primaryJob)) conf += 4
  if (!raw.positioning) conf -= 8
  return Math.round(clamp(conf, 0, 100))
}

export interface NormalizedLandscape {
  competitors: Competitor[]
  droppedLowConfidence: number
}

/** Step 2 (PURE): dedup, canonicalize category/architecture/capabilities, score confidence,
 * drop low-confidence / no-evidence. `relationship` defaults to 'adjacent' until the
 * reasoning pass classifies it. */
export function normalizeLandscape(raw: RawLandscape): NormalizedLandscape {
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
    if (byKey.has(key)) continue
    byKey.set(key, {
      name,
      url: isHttpUrl(rc.url) ? rc.url!.trim() : '',
      category: normalizeCategory(rc.category),
      primaryJob: realJob(rc.primaryJob),
      positioning: rc.positioning ? clean(rc.positioning) : '',
      architecture: normalizeArchitecture(rc.architecture),
      targetCustomer: rc.targetCustomer ? clean(rc.targetCustomer) : undefined,
      confidence,
      relationship: 'adjacent',
      capabilities: caps,
      strengths: rc.strengths.map(clean).filter(Boolean).slice(0, 6),
      weaknesses: rc.weaknesses.map(clean).filter(Boolean).slice(0, 6),
    })
  }

  const competitors = [...byKey.values()].sort((a, b) => b.confidence - a.confidence)
  return { competitors, droppedLowConfidence: dropped }
}
