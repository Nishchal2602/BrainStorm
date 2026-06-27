import type { Agent } from '../../agent'
import type { LlmPort } from '../../llm'
import type { Logger } from '../../logger'
import { now } from '../../runtime'
import type {
  AgentContext,
  AgentResult,
  CapabilityCell,
  Competitor,
  CompetitorPayload,
  Evidence,
  Finding,
  MarketLandscape,
} from '../../types'
import { getDocumentAnalysis, getReviewContext } from '../shared'
import { buildProblemQueries, discoverLandscape } from './discovery'
import { normalizeLandscape } from './extraction'
import { buildCapabilityCells } from './matrix'
import { landscapeSignals, scoreDifferentiation } from './score'

const EMPTY: CompetitorPayload = {
  landscape: { jobs: [], competitors: [], capabilities: [], signals: [] },
  productCategory: '',
  competitorsFound: 0,
  differentiationScore: 0,
  differentiation: 'Low',
  scoreFactors: { novelty: 0, coverage: 0, saturation: 0, missingStandards: 0 },
}

const pct = (n: number): number => Math.round(n * 100)

/** Up to 3 evidence rows for a capability: the competitors that offer it + their quote/URL. */
function cellEvidence(cell: CapabilityCell, byName: Map<string, Competitor>): Evidence[] {
  const out: Evidence[] = []
  for (const name of cell.competitors.slice(0, 3)) {
    const comp = byName.get(name.toLowerCase())
    if (!comp) continue
    const cap = comp.capabilities.find((c) => c.name.toLowerCase() === cell.name.toLowerCase())
    out.push({
      title: comp.name,
      url: cap?.evidence.url || comp.url || undefined,
      snippet: cap?.evidence.quote,
      sourceType: 'competitor',
    })
  }
  return out
}

/** Findings synthesis consumes. Market-framed; "no competitors found" ≠ "no competition". */
function buildFindings(p: CompetitorPayload): Finding[] {
  const land = p.landscape
  const byName = new Map(land.competitors.map((c) => [c.name.toLowerCase(), c]))
  const findings: Finding[] = []

  if (!land.competitors.length) {
    findings.push({
      title: 'Could not map the competitive landscape',
      detail: 'No competitors were located via web search — this reflects search coverage, not an absence of competition. Validate the market directly.',
      kind: 'assumption',
      severity: 'medium',
      confidence: 0.2,
    })
    return findings
  }

  const sf = p.scoreFactors
  findings.push({
    title: `${p.differentiation} differentiation (${p.differentiationScore}/100)`,
    detail: `Novelty ${pct(sf.novelty)}%, coverage ${pct(sf.coverage)}%, saturation room ${pct(sf.saturation)}%, standards covered ${pct(sf.missingStandards)}%. ${p.competitorsFound} competitor(s) mapped.`,
    kind: p.differentiation === 'Low' ? 'risk' : 'insight',
    severity: 'medium',
    confidence: p.differentiationScore / 100,
  })

  // Unique / Rare planned capabilities → potential edge.
  for (const c of land.capabilities.filter((c) => c.status === 'Unique' || c.status === 'Rare').slice(0, 3)) {
    findings.push({
      title: `${c.name} appears in ${c.adoption === 0 ? 'no' : `only ${c.adoption}`} competitor(s)`,
      detail: `Potential differentiator (${c.status}, ${c.maturity.replace('_', ' ')}).`,
      kind: 'insight',
      severity: c.status === 'Unique' ? 'high' : 'medium',
      confidence: 0.6,
      evidence: cellEvidence(c, byName),
    })
  }

  // Missing market standards → gaps the proposal should address.
  for (const c of land.capabilities.filter((c) => c.status === 'Missing').slice(0, 3)) {
    findings.push({
      title: `${c.name} is offered by ${c.adoption}/${p.competitorsFound} competitors but absent from the proposal`,
      detail: `Market standard (${c.maturity.replace('_', ' ')}) the proposal does not list.`,
      kind: 'gap',
      severity: 'medium',
      confidence: 0.6,
      evidence: cellEvidence(c, byName),
    })
  }

  // Heavy commodity overlap → crowded on table stakes.
  const commodity = land.capabilities.filter((c) => c.status === 'Commodity')
  if (commodity.length >= 2) {
    findings.push({
      title: 'Overlaps heavily with mature competitors on table-stakes capabilities',
      detail: `Commodity capabilities: ${commodity.slice(0, 4).map((c) => c.name).join(', ')}.`,
      kind: 'risk',
      severity: 'medium',
      confidence: 0.55,
    })
  }

  for (const s of land.signals) {
    findings.push({
      title: s.kind === 'crowded' ? 'Crowded market' : 'Possible incomplete landscape',
      detail: s.message,
      kind: s.kind === 'crowded' ? 'risk' : 'assumption',
      severity: s.kind === 'crowded' ? 'medium' : 'low',
      confidence: s.kind === 'crowded' ? 0.6 : 0.3,
    })
  }

  return findings.slice(0, 10)
}

/**
 * Competitor Intelligence — a jobs-to-be-done market landscape. Problem-first grounded
 * discovery → evidence-bound capabilities → pure capability matrix + differentiation
 * scoring. One grounded LLM call; everything else pure. Market-framed (absence of found
 * competitors is never "no competition").
 */
export class CompetitorIntelligenceAgent implements Agent {
  readonly id = 'competitor'
  readonly name = 'Competitor Intelligence'

  constructor(
    private readonly logger: Logger,
    private readonly llm: LlmPort,
  ) {}

  async shouldRun(ctx: AgentContext): Promise<boolean> {
    const c = getDocumentAnalysis(ctx)
    if (c?.isNewProduct) return true
    if (c && c.productCategory !== 'Unknown') return true
    const rt = getReviewContext(ctx)?.reviewType
    return rt === 'product_strategy' || rt === 'roadmap'
  }

  async execute(ctx: AgentContext): Promise<AgentResult<CompetitorPayload>> {
    const start = now()
    const dur = () => Math.round(now() - start)
    const analysis = getDocumentAnalysis(ctx)
    const meta = ctx.metadata?.clientId ? { clientId: String(ctx.metadata.clientId) } : undefined

    const queries = buildProblemQueries(analysis)
    if (!queries.length) {
      return { agentId: this.id, summary: 'Insufficient context to map the competitive landscape.', findings: [], confidence: 0, data: EMPTY, status: 'ok', durationMs: dur() }
    }

    try {
      this.logger.info('competitor: queries', { productCategory: analysis?.productCategory, queries })

      const { raw, usage } = await discoverLandscape(this.llm, queries, meta)
      const { competitors, jobs, droppedLowConfidence } = normalizeLandscape(raw, analysis)
      const planned = analysis?.keyCapabilities ?? []
      const capabilities = buildCapabilityCells(competitors, planned)
      const signals = landscapeSignals(analysis, competitors)
      const { differentiationScore, differentiation, scoreFactors } = scoreDifferentiation(
        planned,
        capabilities,
        competitors,
      )

      const landscape: MarketLandscape = { jobs, competitors, capabilities, signals }
      const payload: CompetitorPayload = {
        landscape,
        productCategory: analysis?.productCategory ?? 'Unknown',
        competitorsFound: competitors.length,
        differentiationScore,
        differentiation,
        scoreFactors,
      }
      const findings = buildFindings(payload)

      this.logger.info('competitor: scored', {
        competitorsFound: competitors.length,
        droppedLowConfidence,
        capabilities: capabilities.length,
        differentiationScore,
        differentiation,
        signals: signals.map((s) => s.kind),
        durationMs: dur(),
      })

      const summary = competitors.length
        ? `Mapped ${competitors.length} competitor(s) for ${payload.productCategory}: ${differentiation} differentiation (${differentiationScore}/100).`
        : 'Could not map the competitive landscape (no competitors located) — validate the market directly.'

      return {
        agentId: this.id,
        summary,
        findings,
        confidence: differentiationScore / 100,
        data: payload,
        status: 'ok',
        usage,
        durationMs: dur(),
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.logger.error('competitor: failed', msg)
      return { agentId: this.id, summary: `Competitor Intelligence failed: ${msg}`, findings: [], confidence: 0, data: EMPTY, status: 'error', error: msg, durationMs: dur() }
    }
  }
}
