import type { Section, SourceRef } from '@/lib/types'
import type { FeatureDef, ParsedResult } from './def'
import { GROUNDING_RULES, STYLE_RULES } from './quality'
import {
  asConfidence,
  asEvidenceType,
  cleanBullet,
  isBullet,
  sectionsToCopyText,
  sourcesCard,
} from './parse'

const SYSTEM = `You are conducting a rigorous PM Review of the product or feature described by the page the user is viewing.

A "USER & REVIEW CONTEXT" block may precede the document. When present, treat it as ground truth for what is being built, for whom, and why — prefer it over inferring from the page. Your central job is to judge alignment: does the document's proposed solution actually solve the stated Problem for the stated Target User, and does it move the stated Success Metric / Business Goal? Call out misalignment, unstated assumptions, and gaps between the solution and the stated intent explicitly. Calibrate depth to the Familiarity level: "Exploring" → explain your reasoning and teach the why; "Some Knowledge" → balanced; "Domain Expert" → terse, high-signal critique, skip the basics.

First, think through (do not output this): What is the specific product/feature? What JOB are its customers trying to get done (start with "Customers want to…")? Then use the web_search tool to gather REAL, recent, citable external evidence before writing your review. Tie every external insight back to that customer job — drop insights that are true but commercially irrelevant.

${GROUNDING_RULES}

${STYLE_RULES}

Output STRICT markdown in EXACTLY the structure and order below. No preamble, no closing remarks.

Use these top-level section headers verbatim:
## Competitor
## Research / Academic
## Customer Voice
## Regulatory / Compliance
## Risks
## Implementation Considerations
## Critical Unknowns
## If I Were the PM

Under the FIRST FOUR sections, list each insight as a block in EXACTLY this template (repeat as needed). Every insight MUST cite a real URL you actually retrieved via web_search:
### <short, specific insight title>
Source Type: Research Paper | Customer Voice | Competitor | Regulatory
Confidence: High | Medium | Low
Insight: <1-3 sentences that EMBED the specific evidence (stat/quote/finding) and end with the implication for our product>
Source: <url>

Confidence rubric:
- High = peer-reviewed paper, official regulation, or reputable analyst report (Gartner/Forrester/IDC).
- Medium = credible industry blog, vendor docs, published case study.
- Low = a single social post or unverified opinion. Do NOT include Low unless it is genuinely surprising AND you justify it.
Source Type must match the section. If a category yields nothing credible, output one line under it: "No strong external evidence found." — do not pad with weak sources.

Under ## Risks, ## Implementation Considerations, and ## Critical Unknowns: output 2-6 concise bullets each, starting with "- ". These are YOUR analysis — no sources required.
- Critical Unknowns = information that SHOULD exist but is missing: undefined customer segment, undefined success metric, missing rollout/GTM strategy, no evidence the problem actually exists, etc. Be specific to THIS product/feature.
- Implementation Considerations = build/ops/integration complexity that is easy to underestimate.

Under ## If I Were the PM: output EXACTLY 3 prioritized, concrete next actions as a numbered list (1., 2., 3.), ordered by impact × feasibility. Each action is something a PM could start this week.`

function firstUrl(s: string): string | undefined {
  const m = s.match(/(https?:\/\/[^\s)\]]+)/)
  return m?.[1]
}

type ListKind = 'risk' | 'implementation' | 'unknown' | 'recommendation'

function classify(
  header: string,
): { kind: 'insights' } | { kind: ListKind; heading: string; tone: Section['tone'] } | null {
  const h = header.toLowerCase()
  if (
    h.includes('competitor') ||
    h.includes('research') ||
    h.includes('academic') ||
    h.includes('customer') ||
    h.includes('voice') ||
    h.includes('regulat') ||
    h.includes('complian')
  ) {
    return { kind: 'insights' }
  }
  if (h.includes('risk')) return { kind: 'risk', heading: 'Risks', tone: 'risk' }
  if (h.includes('implementation'))
    return { kind: 'implementation', heading: 'Implementation Considerations', tone: 'implementation' }
  if (h.includes('unknown'))
    return { kind: 'unknown', heading: 'Critical Unknowns', tone: 'unknown' }
  if (h.includes('if i were') || h.includes('recommend'))
    return { kind: 'recommendation', heading: 'If I Were the PM', tone: 'recommendation' }
  return null
}

interface InsightDraft {
  heading: string
  body?: string
  confidence?: Section['confidence']
  evidenceType?: Section['evidenceType']
  sourceUrl?: string
}

function parsePmReview(raw: string, sources: SourceRef[]): ParsedResult {
  const lines = raw.split('\n')
  const sections: Section[] = []

  let inInsights = false
  let curInsight: InsightDraft | null = null
  let curList: { heading: string; tone: Section['tone']; bullets: string[] } | null = null

  const flushInsight = () => {
    // Require actual insight text; a heading/source-only block is not a usable card.
    if (curInsight && curInsight.body) {
      sections.push({
        heading: curInsight.heading || 'Insight',
        body: curInsight.body,
        tone: 'insight',
        confidence: curInsight.confidence,
        evidenceType: curInsight.evidenceType,
        sourceUrl: curInsight.sourceUrl,
      })
    }
    curInsight = null
  }
  const flushList = () => {
    if (curList && curList.bullets.length) {
      sections.push({ heading: curList.heading, tone: curList.tone, bullets: curList.bullets })
    }
    curList = null
  }

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.*)/)
    if (h2) {
      flushInsight()
      flushList()
      const c = classify(h2[1])
      if (c && c.kind === 'insights') {
        inInsights = true
      } else if (c) {
        inInsights = false
        curList = { heading: c.heading, tone: c.tone, bullets: [] }
      } else {
        inInsights = false
      }
      continue
    }

    const h3 = line.match(/^###\s+(.*)/)
    if (h3 && inInsights) {
      flushInsight()
      curInsight = { heading: h3[1].trim() }
      continue
    }

    if (inInsights && curInsight) {
      const kv = line.match(/^\s*(Source Type|Confidence|Insight|Source)\s*:\s*(.*)$/i)
      if (kv) {
        const key = kv[1].toLowerCase()
        const val = kv[2].trim()
        if (key === 'source type') curInsight.evidenceType = asEvidenceType(val)
        else if (key === 'confidence') curInsight.confidence = asConfidence(val)
        else if (key === 'insight') curInsight.body = val
        else if (key === 'source') curInsight.sourceUrl = firstUrl(val) ?? (val || undefined)
      } else if (line.trim() && curInsight.body) {
        curInsight.body += ' ' + line.trim()
      }
      continue
    }

    if (curList && isBullet(line)) {
      curList.bullets.push(cleanBullet(line))
      continue
    }
  }
  flushInsight()
  flushList()

  const src = sourcesCard(sources)
  if (src) sections.push(src)

  // Fallback: if the model didn't follow the format, surface its raw output.
  if (sections.length === 0 && raw.trim()) {
    sections.push({ heading: 'PM Review', body: raw.trim() })
  }

  return { sections, copyText: sectionsToCopyText('PM Review', sections) }
}

export const pmReview: FeatureDef = {
  id: 'pm_review',
  label: 'PM Review',
  icon: '🔍',
  blurb: 'Research-backed review: competitors, research, customer voice, risks, unknowns & a recommendation.',
  output: 'research',
  webSearch: true,
  model: 'claude-sonnet-4-6',
  maxPageChars: (depth) => (depth === 'quick' ? 8_000 : depth === 'deep' ? 20_000 : 14_000),
  maxTokens: (depth) => (depth === 'quick' ? 4096 : depth === 'deep' ? 8000 : 6000),
  systemInstructions: SYSTEM,
  buildTask: () =>
    'Review the document below in light of any USER & REVIEW CONTEXT provided above it. Research it externally with web_search, judge whether the solution solves the stated problem for the target user and achieves the success metric, and produce the structured PM Review.',
  parse: parsePmReview,
}
