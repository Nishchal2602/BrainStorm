import type { Agent } from '../../agent'
import type { LlmPort } from '../../llm'
import type { Logger } from '../../logger'
import { now } from '../../runtime'
import type {
  AgentContext,
  AgentResult,
  Competitor,
  CompetitorPayload,
  Evidence,
  Finding,
  MarketLandscape,
  MarketSegment,
} from '../../types'
import { getDocumentAnalysis, getReviewContext } from '../shared'
import { buildProblemQueries, discoverAndReason, type ReasoningResult } from './discovery'
import { normalizeArchitecture, normalizeCapability, normalizeCategory, normalizeLandscape } from './extraction'
import { buildCapabilityCells } from './matrix'
import { adjacentCategorySuggestions, landscapeSignals, weightDifferentiation } from './score'

const EMPTY: CompetitorPayload = {
  landscape: {
    proposal: { category: '', primaryJob: '', architecture: '', positioning: '' },
    category: '',
    maturity: 'Low',
    competitors: [],
    segments: [],
    capabilities: [],
    whiteSpace: [],
    signals: [],
  },
  productCategory: '',
  competitorsFound: 0,
  differentiationScore: 0,
  differentiation: 'Low',
  differentiationScores: {
    marketOverlap: 0,
    architectureNovelty: 0,
    capabilityDifferentiation: 0,
    positioningDifferentiation: 0,
  },
  recommendation: '',
}

/** Pure fallback when the reasoning section fails to parse — degrade gracefully, never invent white space. */
function fallbackReasoning(
  analysis: ReturnType<typeof getDocumentAnalysis>,
  competitors: Competitor[],
  cells: { name: string; adoption: number }[],
): ReasoningResult {
  const proposalCategory = normalizeCategory(analysis?.solutionCategory || analysis?.productCategory)
  const planned = analysis?.keyCapabilities ?? []
  // cells are keyed by canonical name → normalize the planned name on lookup too.
  const byCap = new Map(cells.map((c) => [c.name.toLowerCase(), c.adoption]))
  const rarePlanned = planned.filter((p) => (byCap.get(normalizeCapability(p).toLowerCase()) ?? 0) === 0).length
  // Conservative: without the reasoning pass, evidence-gated competitor caps make
  // "adoption 0" ambiguous (missing evidence vs genuinely unique) — cap inferred uniqueness.
  const capabilityDifferentiation = planned.length
    ? Math.min(50, Math.round((rarePlanned / planned.length) * 100))
    : 40

  const relationships = competitors.map((c) => ({
    competitor: c.name,
    relationship: (c.category === proposalCategory ? 'direct' : 'adjacent') as 'direct' | 'adjacent',
    reason: c.category === proposalCategory ? 'Same market category' : 'Related category',
  }))
  const direct = relationships.filter((r) => r.relationship === 'direct').length
  const marketOverlap = Math.round(Math.min(100, (direct / Math.max(1, competitors.length)) * 100))

  const bySeg = new Map<string, string[]>()
  for (const c of competitors) {
    const arr = bySeg.get(c.category) ?? []
    arr.push(c.name)
    bySeg.set(c.category, arr)
  }
  const segments: MarketSegment[] = [...bySeg.entries()].map(([name, comps]) => ({ name, competitors: comps }))

  return {
    proposal: {
      category: proposalCategory,
      primaryJob: analysis?.coreProblem || analysis?.productCategory || '',
      architecture: normalizeArchitecture(planned.join(' ')),
      positioning: '',
    },
    marketCategory: proposalCategory,
    marketMaturity: competitors.length >= 5 ? 'High' : competitors.length >= 2 ? 'Medium' : 'Low',
    segments,
    relationships,
    whiteSpace: [],
    scores: { marketOverlap, architectureNovelty: 50, capabilityDifferentiation, positioningDifferentiation: 40 },
    recommendation:
      `Identified ${competitors.length} product(s) in the ${proposalCategory} space. Detailed differentiation reasoning was unavailable this run — treat the read as directional and validate positioning directly.`,
    insights: [],
  }
}

function topEvidence(competitors: Competitor[]): Evidence[] {
  return competitors
    .slice(0, 3)
    .map((c) => ({ title: c.name, url: c.url || undefined, sourceType: 'competitor' }))
}

function buildFindings(p: CompetitorPayload, competitors: Competitor[]): Finding[] {
  const findings: Finding[] = []
  const sf = p.differentiationScores
  findings.push({
    title: `${p.differentiation} differentiation (${p.differentiationScore}/100)`,
    detail: `${p.recommendation} (Positioning ${sf.positioningDifferentiation}, Architecture ${sf.architectureNovelty}, Capability ${sf.capabilityDifferentiation}, Market overlap ${sf.marketOverlap}.)`,
    kind: p.differentiation === 'Low' ? 'risk' : 'insight',
    severity: 'medium',
    confidence: p.differentiationScore / 100,
    evidence: topEvidence(competitors),
  })
  for (const ins of p.landscape.whiteSpace.slice(0, 3)) {
    findings.push({
      title: ins.opportunity,
      detail: ins.rationale || 'Strategic white space — absent among discovered competitors.',
      kind: 'insight',
      severity: 'medium',
      confidence: 0.55,
    })
  }
  for (const s of p.landscape.signals) {
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
 * Competitor Intelligence — a market-positioning & white-space reasoning engine.
 * ONE grounded LLM call performs discovery AND market reasoning in the same pass
 * (segments, relationship classes, strategic white space, differentiation scores);
 * everything else is pure — normalization, capability matrix, positioning-weighted
 * score, and a pure reasoning fallback when the analysis section fails to parse.
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
    const productCategory = analysis?.productCategory ?? 'Unknown'

    const queries = buildProblemQueries(analysis)
    if (!queries.length) {
      return { agentId: this.id, summary: 'Insufficient context to map the competitive landscape.', findings: [], confidence: 0, data: EMPTY, status: 'ok', durationMs: dur() }
    }

    try {
      this.logger.info('competitor: queries', { productCategory, queries })
      // THE one grounded call: discovery + market reasoning in a single pass.
      const { raw, reasoning, usage: discoveryUsage } = await discoverAndReason(
        this.llm, analysis, queries, meta,
      )
      const { competitors, droppedLowConfidence } = normalizeLandscape(raw)

      // No competitors located — framed as coverage, never "no competition exists".
      if (!competitors.length) {
        const adj = adjacentCategorySuggestions(analysis)
        const recommendation =
          'No competitors identified from available evidence. This reflects search coverage, not an absence of competition' +
          (adj.length ? `. Consider adjacent categories (${adj.join(', ')}) and validate the market directly.` : '. Validate the market directly.')
        this.logger.info('competitor: no competitors', { droppedLowConfidence, durationMs: dur() })
        return {
          agentId: this.id,
          summary: 'No competitors identified from available evidence — validate the market directly.',
          findings: [{ title: 'No competitors identified from available evidence', detail: recommendation, kind: 'assumption', severity: 'low', confidence: 0.2 }],
          confidence: 0,
          data: { ...EMPTY, productCategory, recommendation, landscape: { ...EMPTY.landscape, category: productCategory } },
          status: 'ok',
          usage: discoveryUsage,
          durationMs: dur(),
        }
      }

      const cells = buildCapabilityCells(competitors, analysis?.keyCapabilities ?? [])

      // Reasoning parsed from the same response; malformed/missing → pure fallback
      // (discovered competitors are kept either way).
      let result: ReasoningResult
      if (reasoning) {
        result = reasoning
      } else {
        this.logger.warn('competitor: reasoning section missing/malformed, pure fallback')
        result = fallbackReasoning(analysis, competitors, cells)
      }

      // Apply relationship classification AFTER normalization, tolerating name
      // drift between REL lines and canonicalized competitor names
      // (exact → substring containment, e.g. "Jira" ↔ "Atlassian Jira").
      const rels = result.relationships.map((r) => ({ ...r, key: r.competitor.toLowerCase().trim() }))
      for (const c of competitors) {
        const name = c.name.toLowerCase().trim()
        const r =
          rels.find((x) => x.key === name) ??
          rels.find((x) => x.key.includes(name) || name.includes(x.key))
        if (r) {
          c.relationship = r.relationship
          c.relationshipReason = r.reason
        }
      }

      const signals = landscapeSignals(analysis, competitors)
      const { differentiationScore, differentiation } = weightDifferentiation(result.scores)

      const landscape: MarketLandscape = {
        proposal: result.proposal,
        category: result.marketCategory || productCategory,
        maturity: result.marketMaturity,
        competitors,
        segments: result.segments,
        capabilities: cells,
        whiteSpace: result.whiteSpace,
        signals,
      }
      const payload: CompetitorPayload = {
        landscape,
        productCategory,
        competitorsFound: competitors.length,
        differentiationScore,
        differentiation,
        differentiationScores: result.scores,
        recommendation: result.recommendation,
      }

      // Strategic insights from the reasoning pass become synthesis findings.
      const findings = buildFindings(payload, competitors)
      for (const ins of result.insights.slice(0, 4)) {
        findings.push({
          title: ins.statement,
          detail: '',
          kind: ins.type === 'risk' ? 'risk' : 'insight',
          severity: ins.type === 'risk' ? 'medium' : 'low',
          confidence: 0.5,
          evidence: topEvidence(competitors),
        })
      }

      this.logger.info('competitor: scored', {
        competitorsFound: competitors.length,
        droppedLowConfidence,
        segments: landscape.segments.length,
        relationships: { direct: competitors.filter((c) => c.relationship === 'direct').length },
        differentiationScore,
        differentiation,
        signals: signals.map((s) => s.kind),
        durationMs: dur(),
      })

      return {
        agentId: this.id,
        summary: `${landscape.category}: ${competitors.length} competitor(s), ${differentiation} differentiation (${differentiationScore}/100).`,
        findings: findings.slice(0, 12),
        confidence: differentiationScore / 100,
        data: payload,
        status: 'ok',
        usage: discoveryUsage,
        durationMs: dur(),
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.logger.error('competitor: failed', msg)
      return { agentId: this.id, summary: `Competitor Intelligence failed: ${msg}`, findings: [], confidence: 0, data: EMPTY, status: 'error', error: msg, durationMs: dur() }
    }
  }
}
