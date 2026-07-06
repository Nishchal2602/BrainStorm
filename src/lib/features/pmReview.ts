import type { Section, SourceRef } from '@/lib/types'
import type { FeatureDef, ParsedResult } from './def'
import { STYLE_RULES } from './quality'
import { asConfidence, sectionsToCopyText, sourcesCard } from './parse'

// ---------------------------------------------------------------------------
// Staff-PM implementation-readiness reviewer.
// The model returns XML (far more robust than markdown for structured output);
// parsing is plain tag extraction — no DOMParser (unavailable in MV3 workers).
// The same SYSTEM + parser also powers the deep-analysis PmReviewAgent.
// ---------------------------------------------------------------------------

export const PM_REVIEW_SYSTEM = `You are a Staff Product Manager reviewing a Product Requirements Document before it is approved for engineering implementation.

Your job is NOT to evaluate whether the idea is good. Assume customer validation, competitor research, and market analysis have already been performed elsewhere — ignore those topics entirely unless they directly impact implementation. Do NOT discuss competitors, GTM, pricing, customer demand, or market trends.

Your job is to determine whether the PRD is complete, unambiguous, implementable, and ready to build. Review it from the perspective of an engineering team that must build exactly what is written.

A "USER & REVIEW CONTEXT" block may precede the document. When present, treat it as ground truth for what is being built, for whom, and why — judge the PRD's problem definition and requirements against it.

GROUNDING:
- The document is the source of truth. Reference its sections precisely; never invent content that is not there.
- When a conclusion is inferred rather than stated, prefix it with "Assumption:".
- Never ask engineering to make a product decision. If a requirement is unspecified and engineering would need to choose the behaviour, flag it as a missing requirement — product owns behaviour; engineering owns implementation.

EVALUATION FRAMEWORK — assess all ten dimensions:
1. Problem definition — does the PRD clearly define the problem, affected users, desired outcome, and constraints? Identify missing context.
2. Functional requirements — for every feature: missing behaviour, undefined workflows, ambiguous logic, unspecified state transitions, unclear ownership, undefined inputs/outputs.
3. User flows — onboarding, happy path, edge paths, failures, retries, cancellations, skipped actions, recovery. Point out missing flows.
4. Edge cases — empty state, invalid input, missing data, partial completion, retries, duplicate actions, conflicting state, offline behaviour, system failures.
5. Acceptance criteria — does every feature have measurable completion criteria? Flag features that cannot be tested as written.
6. Non-functional requirements — latency, scalability, availability, reliability, security, privacy, monitoring, logging, auditability.
7. Dependencies — missing dependencies between systems, services, or teams.
8. Risks — implementation risks ONLY (algorithm uncertainty, data quality, migration, technical debt, operational complexity). Not market risks.
9. Prioritization — does the PRD distinguish Must Have / Should Have / Could Have / Won't Have? If not, explain the implementation risk this creates.
10. Overall readiness — a 0-100 readiness score and a decision.

${STYLE_RULES}

Do NOT summarize the document. Do NOT rewrite the PRD. Avoid generic advice like "add more detail" — every fix must state exactly what information needs to be added, and where possible include a copy-pasteable suggested addition.

Respond with XML ONLY — exactly this structure, no prose outside the tags:
<review>
  <strengths>
    <item>a part of the PRD that is implementation-ready as written (2-5 items; leave the tag empty if none)</item>
  </strengths>
  <critical>
    <issue>
      <title>short, specific issue title</title>
      <where>the PRD section or quote it refers to</where>
      <why>why it is insufficient</why>
      <impact>the engineering impact</impact>
      <fix>exactly what information must be added</fix>
      <example>optional: a copy-pasteable suggested addition, 1-3 compact lines</example>
      <confidence>High|Medium|Low — how certain you are the issue is real rather than inferred</confidence>
    </issue>
  </critical>
  <medium>same issue blocks — important but not blocking</medium>
  <minor>same issue blocks — nice-to-have improvements</minor>
  <missing>
    <requirements><item>each explicitly missing requirement and why it matters</item></requirements>
    <userFlows><item>each missing user journey</item></userFlows>
    <edgeCases><item>each important edge case the PRD ignores</item></edgeCases>
    <acceptanceCriteria><item>write the actual suggested criterion — measurable and testable</item></acceptanceCriteria>
    <nonFunctional><item>each missing non-functional specification</item></nonFunctional>
  </missing>
  <questions>
    <product><item>behaviour decisions the PM must make</item></product>
    <engineering><item>implementation choices to raise with engineering</item></engineering>
  </questions>
  <score>
    <criticalIssues>count</criticalIssues>
    <mediumIssues>count</mediumIssues>
    <minorIssues>count</minorIssues>
    <readiness>0-100</readiness>
    <decision>Ready to Build | Build with Changes | Needs Major Revision</decision>
    <confidence>High|Medium|Low — how certain YOU are of this assessment (independent of the score)</confidence>
    <rationale>2-4 sentences explaining the score and decision</rationale>
  </score>
</review>

Critical = blocks engineering from implementing. Medium = important but not blocking. Minor = nice-to-have. Populate <criticalIssues>/<mediumIssues>/<minorIssues> with the counts of issue blocks you produced.`

// --- XML tag extraction (pure; tolerant of missing/extra whitespace) ---

const unescapeXml = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

/** All inner contents of <tag>…</tag> occurrences (raw, un-decoded). */
function blocks(raw: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'gi')
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) out.push(m[1])
  return out
}

/** Decoded text of the first <tag> inside a block; undefined when absent/empty. */
function text(block: string | undefined, tag: string): string | undefined {
  if (!block) return undefined
  const v = blocks(block, tag)[0]?.trim()
  return v ? unescapeXml(v) : undefined
}

/** Decoded <item> list of the first <tag> inside a block. */
function items(block: string | undefined, tag: string): string[] {
  const container = block ? blocks(block, tag)[0] : undefined
  if (!container) return []
  return blocks(container, 'item')
    .map((s) => unescapeXml(s.trim()))
    .filter(Boolean)
}

// --- Typed review (shared with the deep-analysis PmReviewAgent) ---

export interface ReadinessIssue {
  title: string
  where?: string
  why?: string
  impact?: string
  fix?: string
  /** Copy-pasteable suggested addition. */
  example?: string
  /** How certain the reviewer is that the issue is real (not inferred). */
  confidence?: Section['confidence']
}

export interface ReadinessReview {
  strengths: string[]
  critical: ReadinessIssue[]
  medium: ReadinessIssue[]
  minor: ReadinessIssue[]
  missingRequirements: string[]
  missingUserFlows: string[]
  missingEdgeCases: string[]
  missingAcceptanceCriteria: string[]
  missingNfrs: string[]
  productQuestions: string[]
  engineeringQuestions: string[]
  /** 0-100 (model-derived, not string-parsed from prose). */
  readiness?: number
  decision?: string
  /** Reviewer certainty — deliberately SEPARATE from the readiness score. */
  reviewerConfidence?: Section['confidence']
  rationale?: string
}

const DECISIONS = ['Ready to Build', 'Build with Changes', 'Needs Major Revision'] as const

function asDecision(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const v = raw.toLowerCase()
  return DECISIONS.find((d) => v.includes(d.toLowerCase())) ?? raw.trim()
}

function parseIssues(raw: string, tag: string): ReadinessIssue[] {
  const container = blocks(raw, tag)[0]
  if (!container) return []
  return blocks(container, 'issue')
    .map((b) => ({
      title: text(b, 'title') ?? 'Issue',
      where: text(b, 'where'),
      why: text(b, 'why'),
      impact: text(b, 'impact'),
      fix: text(b, 'fix'),
      example: text(b, 'example'),
      confidence: asConfidence(text(b, 'confidence') ?? ''),
    }))
    .filter((i) => i.why || i.fix || i.where)
}

function issueCard(prefix: string, i: ReadinessIssue, tone: Section['tone']): Section {
  const bullets = [
    i.where && `Where: ${i.where}`,
    i.why && `Why: ${i.why}`,
    i.impact && `Impact: ${i.impact}`,
    i.fix && `Fix: ${i.fix}`,
    i.example && `Suggested addition: ${i.example}`,
  ].filter((b): b is string => Boolean(b))
  return { heading: `${prefix} — ${i.title}`, tone, confidence: i.confidence, bullets }
}

function listCard(heading: string, itemsList: string[], tone: Section['tone']): Section | null {
  return itemsList.length ? { heading, tone, bullets: itemsList } : null
}

/**
 * Parse the model's XML into the typed review + presentation-ready cards.
 * Used by BOTH the standalone feature (via parsePmReview) and PmReviewAgent.
 */
export function parseReadinessReview(rawInput: string): {
  review: ReadinessReview
  sections: Section[]
} {
  // Tolerate accidental markdown code fences around the XML.
  const raw = rawInput
    .trim()
    .replace(/^```(?:xml)?\s*/i, '')
    .replace(/```$/, '')

  const missing = blocks(raw, 'missing')[0]
  const questions = blocks(raw, 'questions')[0]
  const score = blocks(raw, 'score')[0]

  const readinessNum = Number(text(score, 'readiness'))
  const review: ReadinessReview = {
    strengths: items(raw, 'strengths'),
    critical: parseIssues(raw, 'critical'),
    medium: parseIssues(raw, 'medium'),
    minor: parseIssues(raw, 'minor'),
    missingRequirements: items(missing, 'requirements'),
    missingUserFlows: items(missing, 'userFlows'),
    missingEdgeCases: items(missing, 'edgeCases'),
    missingAcceptanceCriteria: items(missing, 'acceptanceCriteria'),
    missingNfrs: items(missing, 'nonFunctional'),
    productQuestions: items(questions, 'product'),
    engineeringQuestions: items(questions, 'engineering'),
    readiness: Number.isFinite(readinessNum)
      ? Math.min(100, Math.max(0, Math.round(readinessNum)))
      : undefined,
    decision: asDecision(text(score, 'decision')),
    reviewerConfidence: asConfidence(text(score, 'confidence') ?? ''),
    rationale: text(score, 'rationale'),
  }

  const sections: Section[] = []

  // 1 — The verdict leads.
  if (review.readiness != null || review.decision || review.rationale) {
    const scoreLabel = review.readiness != null ? ` (${review.readiness}/100)` : ''
    sections.push({
      heading: review.decision
        ? `Overall Readiness — ${review.decision}${scoreLabel}`
        : `Overall Readiness${scoreLabel}`,
      body: review.rationale,
      tone: 'recommendation',
      confidence: review.reviewerConfidence,
    })
  }

  // 2 — What is already implementation-ready (trust, not just critique).
  const strengths = listCard('Implementation Strengths', review.strengths, 'insight')
  if (strengths) sections.push(strengths)

  // 3-5 — Issues, one card each, severity via tone + heading prefix.
  for (const i of review.critical) sections.push(issueCard('Critical', i, 'risk'))
  for (const i of review.medium) sections.push(issueCard('Medium', i, 'unknown'))
  for (const i of review.minor) sections.push(issueCard('Minor', i, 'implementation'))

  // 6 — Explicit gaps.
  const gaps: Array<Section | null> = [
    listCard('Missing Requirements', review.missingRequirements, 'unknown'),
    listCard('Missing User Flows', review.missingUserFlows, 'unknown'),
    listCard('Missing Edge Cases', review.missingEdgeCases, 'unknown'),
    listCard('Missing Acceptance Criteria', review.missingAcceptanceCriteria, 'unknown'),
    listCard('Missing Non-Functional Requirements', review.missingNfrs, 'unknown'),
  ]
  for (const g of gaps) if (g) sections.push(g)

  // 7 — Questions, split by audience.
  const qs: Array<Section | null> = [
    listCard('Questions for Product', review.productQuestions, 'unknown'),
    listCard('Questions for Engineering', review.engineeringQuestions, 'unknown'),
  ]
  for (const q of qs) if (q) sections.push(q)

  return { review, sections }
}

function parsePmReview(raw: string, sources: SourceRef[]): ParsedResult {
  const { sections } = parseReadinessReview(raw)

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
  blurb: 'Implementation-readiness review: gaps, edge cases, acceptance criteria & a readiness score.',
  output: 'research',
  webSearch: false,
  model: 'claude-sonnet-4-6',
  maxPageChars: (depth) => (depth === 'quick' ? 8_000 : depth === 'deep' ? 20_000 : 14_000),
  maxTokens: (depth) => (depth === 'quick' ? 4096 : depth === 'deep' ? 8000 : 6000),
  systemInstructions: PM_REVIEW_SYSTEM,
  buildTask: () =>
    'Review the PRD below against any USER & REVIEW CONTEXT provided above it, and return the implementation-readiness review as the specified XML.',
  parse: parsePmReview,
}
