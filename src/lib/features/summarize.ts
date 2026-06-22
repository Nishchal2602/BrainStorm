import type { Section } from '@/lib/types'
import type { FeatureDef, ParsedResult } from './def'
import { GROUNDING_RULES, STYLE_RULES } from './quality'
import { parseJsonObject, sectionsToCopyText } from './parse'

interface Summary {
  executiveSummary: string
  keyInsights: string[]
  risks: string[]
  openQuestions: string[]
}

const SCHEMA = {
  type: 'object',
  properties: {
    executiveSummary: { type: 'string' },
    keyInsights: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['executiveSummary', 'keyInsights', 'risks', 'openQuestions'],
  additionalProperties: false,
}

function parse(raw: string): ParsedResult {
  const s = parseJsonObject<Summary>(raw)
  const sections: Section[] = [
    { heading: 'Executive Summary', body: s.executiveSummary },
    { heading: 'Key Insights', bullets: s.keyInsights },
    { heading: 'Risks', tone: 'risk', bullets: s.risks },
    { heading: 'Open Questions', tone: 'unknown', bullets: s.openQuestions },
  ]
  return { sections, copyText: sectionsToCopyText('Summary', sections) }
}

export const summarize: FeatureDef = {
  id: 'summarize',
  label: 'Summarize',
  icon: '📄',
  blurb: 'Executive summary, key insights, risks, and open questions.',
  output: 'structured',
  jsonSchema: SCHEMA,
  model: 'claude-haiku-4-5',
  maxPageChars: () => 12_000,
  comingSoon: true,
  maxTokens: () => 2048,
  systemInstructions: `Summarize the page for a busy PM, in the voice set by your role.

${GROUNDING_RULES}

${STYLE_RULES}

- Executive Summary (2-4 sentences): synthesize — do not parrot. Answer: what is this, why should this role care, and what is the recommended next step?
- Key Insights (3-5): each is a fact PLUS its implication, e.g. "40% of free users churn in week 2 -> Action: add an activation milestone to onboarding."
- Risks (2-4): rank each by (Likelihood x Impact); no generic risks.
- Open Questions (2-4): specific unknowns that should be answered before proceeding (distinct from insights).`,
  buildTask: () => 'Summarize the page below.',
  parse,
}
