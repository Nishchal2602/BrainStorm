import type { Section, TokenUsage } from '@/lib/types'
import type { LlmPort } from './llm'
import type { Logger } from './logger'
import { getDocumentAnalysis } from './agents/shared'
import type {
  AgentContext,
  AgentResult,
  BuildDecision,
  Decision,
  SynthesisReport,
} from './types'

const DECISIONS: BuildDecision[] = ['build', 'build_with_changes', 'validate_first', 'do_not_build']

const DECISION_LABEL: Record<BuildDecision, string> = {
  build: '✅ Build',
  build_with_changes: '🛠 Build with changes',
  validate_first: '🔬 Validate first',
  do_not_build: '🛑 Do not build',
}

// Gemini responseSchema is an OpenAPI subset — no `additionalProperties`.
const strArr = { type: 'array', items: { type: 'string' } }
const SCHEMA = {
  type: 'object',
  properties: {
    executiveSummary: { type: 'string' },
    recommendation: { type: 'string' },
    confidence: { type: 'number' },
    supportingEvidence: strArr,
    contradictingEvidence: strArr,
    risks: strArr,
    openQuestions: strArr,
    suggestedExperiments: strArr,
    missingRequirements: strArr,
    finalVerdict: { type: 'string' },
    decision: {
      type: 'object',
      properties: {
        recommendation: {
          type: 'string',
          enum: ['build', 'build_with_changes', 'validate_first', 'do_not_build'],
        },
        confidence: { type: 'number' },
        rationale: strArr,
      },
      required: ['recommendation', 'confidence', 'rationale'],
    },
  },
  required: [
    'executiveSummary',
    'recommendation',
    'confidence',
    'supportingEvidence',
    'contradictingEvidence',
    'risks',
    'openQuestions',
    'suggestedExperiments',
    'missingRequirements',
    'finalVerdict',
    'decision',
  ],
} as const

const SYSTEM = `You are a senior product leader making a build decision. You are given a product document plus structured findings from specialist agents (customer voice, research, competitor, compliance, solution critic, PRD quality). Some agents may report nothing yet — weigh only real signal.

Reason ACROSS the findings — do not merely concatenate them. Resolve tension between supporting and contradicting evidence, weigh risks and missing requirements, and reach ONE decision:
- "build": strong evidence, manageable risk, requirements clear.
- "build_with_changes": worth building but specific gaps/risks must be addressed first.
- "validate_first": the core problem or demand is unproven; run cheap validation before committing.
- "do_not_build": evidence is weak/contradicting or risk outweighs value.

Customer Voice rule: a customer-voice "insufficient public evidence" / "no evidence found" finding means relevant public discussion was not located — it is NOT evidence that demand is absent. Treat missing evidence as a reason to validate_first, never as contradicting evidence or grounds for do_not_build. Only findings that report actual contradicting discussions count against demand.

Set decision.confidence in [0,1] reflecting how strong the evidence is (low when agents returned little). decision.rationale = the 2–5 reasons that drove the call. Be specific to THIS document; never invent evidence not present in the inputs. Keep every list concise and decision-relevant.`

function serializeResults(results: AgentResult[]): string {
  const active = results.filter((r) => r.status === 'ok' || r.status === 'error' || r.status === 'timeout')
  if (!active.length) return '(no agent findings)'
  return active
    .map((r) => {
      const findings = r.findings.length
        ? r.findings.map((f) => `    - [${f.kind ?? 'note'}] ${f.title}: ${f.detail}`).join('\n')
        : '    (none)'
      const status = r.status === 'ok' ? '' : ` [${r.status}]`
      return `- ${r.agentId}${status} (confidence ${r.confidence}): ${r.summary}\n${findings}`
    })
    .join('\n')
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)
const arr = (v: string[] | undefined): string[] => (Array.isArray(v) ? v : [])

/** Step 5: the one heavy structured call that turns findings into a decision. */
export class Synthesizer {
  constructor(
    private readonly llm: LlmPort,
    private readonly logger: Logger,
  ) {}

  async synthesize(
    ctx: AgentContext,
    results: AgentResult[],
  ): Promise<{ report: SynthesisReport; usage?: TokenUsage }> {
    this.logger.debug('synthesize', { agentResults: results.length })
    const analysis = getDocumentAnalysis(ctx)
    const parts = ['PRODUCT DOCUMENT:', ctx.document, '']
    if (analysis) {
      parts.push(
        `DOCUMENT-ANALYSIS CONFIDENCE: ${analysis.confidence.toFixed(2)} (how clearly the document stated the problem). If low (≲0.5), the problem is under-specified — prefer "validate_first" and temper your decision confidence accordingly.`,
        '',
      )
    }
    parts.push('AGENT FINDINGS:', serializeResults(results))
    const user = parts.join('\n')

    const { data, usage } = await this.llm.generateStructured<SynthesisReport>({
      system: SYSTEM,
      user,
      schema: SCHEMA as object,
      maxTokens: 4000,
      label: 'synthesis',
      meta: ctx.metadata?.clientId ? { clientId: String(ctx.metadata.clientId) } : undefined,
    })

    // Normalize the decision defensively (model may stray on enum/confidence).
    const raw = data.decision?.recommendation
    const rec: BuildDecision = raw && DECISIONS.includes(raw) ? raw : 'validate_first'
    const decision: Decision = {
      recommendation: rec,
      confidence: clamp01(data.decision?.confidence ?? 0),
      rationale: arr(data.decision?.rationale),
    }
    // Coerce every list defensively so reportToSections never reads .length of
    // undefined when a provider returns parseable-but-incomplete JSON.
    return {
      report: {
        ...data,
        confidence: clamp01(data.confidence),
        supportingEvidence: arr(data.supportingEvidence),
        contradictingEvidence: arr(data.contradictingEvidence),
        risks: arr(data.risks),
        openQuestions: arr(data.openQuestions),
        suggestedExperiments: arr(data.suggestedExperiments),
        missingRequirements: arr(data.missingRequirements),
        decision,
      },
      usage,
    }
  }
}

function listSection(heading: string, items: string[], tone: Section['tone']): Section | null {
  return items.length ? { heading, bullets: items, tone } : null
}

/** Render the report to cards — the decision verdict leads. */
export function reportToSections(report: SynthesisReport): Section[] {
  const sections: Section[] = []
  const d = report.decision
  const pct = Math.round(d.confidence * 100)

  // Decision card first.
  sections.push({
    heading: `Decision: ${DECISION_LABEL[d.recommendation]} (${pct}% confidence)`,
    body: report.recommendation,
    bullets: d.rationale,
    tone: 'recommendation',
  })

  if (report.executiveSummary) {
    sections.push({ heading: 'Executive Summary', body: report.executiveSummary, tone: 'default' })
  }

  const lists: Array<Section | null> = [
    listSection('Supporting Evidence', report.supportingEvidence, 'insight'),
    listSection('Contradicting Evidence', report.contradictingEvidence, 'risk'),
    listSection('Risks', report.risks, 'risk'),
    listSection('Missing Requirements', report.missingRequirements, 'unknown'),
    listSection('Open Questions', report.openQuestions, 'unknown'),
    listSection('Suggested Experiments', report.suggestedExperiments, 'implementation'),
  ]
  for (const s of lists) if (s) sections.push(s)

  if (report.finalVerdict) {
    sections.push({ heading: 'Final Verdict', body: report.finalVerdict, tone: 'recommendation' })
  }
  return sections
}
