import type { ResearchDepth, Section, SourceRef } from '@/lib/types'
import type { FeatureDef, ParsedResult } from './def'
import { STYLE_RULES } from './quality'
import { asConfidence, sectionsToCopyText, sourcesCard } from './parse'
import { headingKey } from '@/lib/navigation'
import { renderSectionView, type SectionView } from '@/lib/sectionView'

// ---------------------------------------------------------------------------
// Staff-PM implementation-readiness reviewer.
// The model returns XML (far more robust than markdown for structured output);
// parsing is plain tag extraction — no DOMParser (unavailable in MV3 workers).
// The same SYSTEM + parser also powers the deep-analysis PmReviewAgent.
// ---------------------------------------------------------------------------

// Patch-writing contract — shared verbatim by the full review prompt and the
// per-issue Retry prompt so both paths produce identical patch quality.
export const PATCH_RULES = `PATCH GENERATION — every issue must also carry a <patch>: the exact text that belongs in the PRD, ready to paste.
- Emit exactly ONE <patch> per issue — the single best fix, deterministic. Never offer alternatives.
- Extend the existing document, not rewrite it. Locate the target section in the document, read its existing text, and generate ONLY the missing content.
- If the surrounding section already contains this information, emit an empty <content></content> instead of duplicating it.
- <content> is markdown only, ready to paste: never XML, never commentary or preamble ("Here is the revised section:"), never bullets explaining your work, never instructions ("You should...", "Define..."). Write the actual PRD text in the document's voice.
- Preserve the document's heading hierarchy, bullet style, numbering, tables and formatting conventions.
- Every patch must: be implementation-ready; remove ambiguity; define measurable behavior; preserve document style; avoid marketing language; avoid repeating existing text; introduce concrete examples where useful.
- Generate the shortest patch that completely resolves the issue — one sentence or a full section, whatever it truly needs.
- <targetHeading> must be the EXACT heading text from the DOCUMENT OUTLINE, copied verbatim. If the right section does not exist, use action append with targetHeading = the existing heading the new section should follow, and start <content> with the new heading.
- Escape < > & as XML entities inside <content>.`

/**
 * Findings-first review (Phase 6A) — currently OFF by product decision.
 *
 * false (current): the review emits every AI Draft inline, so drafts are present
 * the moment the review lands. This is the UX the owner wants — no per-issue wait,
 * nothing to click before there is something to read.
 *
 * true: the review returns FINDINGS ONLY and each draft is written later, on
 * demand, grounded in that section's real content (buildGroundedPatchPrompt).
 * Better raw draft quality — the review necessarily sees a head/tail TRUNCATED
 * document (8k chars at the default depth, middle replaced by a marker) while
 * PATCH_RULES tells the model to "read the target section's existing text" and
 * "preserve bullet style"; when the target section sits in the omitted middle that
 * is impossible, so the model invents a plausible section. That is the direct cause
 * of duplicated headings and repeated content.
 *
 * The tradeoff being taken: instant drafts, at the cost of the bulk path guessing
 * at sections it cannot see. The grounding machinery stays live either way — the
 * per-issue Retry path always regenerates against the real section, so any weak
 * inline draft is one click from a grounded rewrite.
 */
export const GROUNDED_DRAFTS = false

/**
 * How much document the review may see, by depth. ONE definition — the Retry and
 * deep paths in the service worker previously carried their own hardcoded 14k/20k
 * literals, so raising the FeatureDef alone fixed only one of three paths.
 *
 * Raised substantially for Phase 7: coverage checking asks "is X stated anywhere in
 * this document?", and the old budgets dropped ~65% of a 40KB PRD's middle — exactly
 * where formats, schemas and limits live — which manufactures false "missing"
 * findings. Input tokens were never the binding constraint here; output tokens were.
 */
export const REVIEW_PAGE_CHARS: Record<ResearchDepth, number> = {
  quick: 24_000,
  standard: 60_000,
  deep: 120_000,
}

function pmReviewSystem(withPatches: boolean): string {
  return `You are a Staff Product Manager reviewing a Product Requirements Document before it is approved for engineering implementation.

Your job is NOT to evaluate whether the idea is good. Assume customer validation, competitor research, and market analysis have already been performed elsewhere — ignore those topics entirely unless they directly impact implementation. Do NOT discuss competitors, GTM, pricing, customer demand, or market trends.

Your job is to determine whether the PRD is complete, unambiguous, implementable, and ready to build. Review it from the perspective of an engineering team that must build exactly what is written.

A "USER & REVIEW CONTEXT" block may precede the document. When present, treat it as ground truth for what is being built, for whom, and why — judge the PRD's problem definition and requirements against it.

GROUNDING:
- The document is the source of truth. Reference its sections precisely; never invent content that is not there.
- When a conclusion is inferred rather than stated, prefix it with "Assumption:".
- Never ask engineering to make a product decision. If a requirement is unspecified and engineering would need to choose the behaviour, flag it as a missing requirement — product owns behaviour; engineering owns implementation.

EVALUATION FRAMEWORK — assess all thirteen dimensions:
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
11. Technical soundness — for anything the document says the system will DO, is it specified precisely enough to build? Unstated data formats, encodings, schemas, size/volume limits, timeouts, retries, idempotency, concurrency, error taxonomies, observability. Report these in <technical>.
12. Dangling references — anything the document MENTIONS but never DEFINES. If it says it consumes a file, is the format stated? If it calls a service, is the failure behaviour stated? Treat an entity introduced without its required attributes as a gap even when the prose reads fluently. Any COVERAGE CHECKLIST below lists specific instances already found by a scan of the full document.
13. Policy and compliance — where the document touches a regulated area (payment card data, personal data, KYC/AML, health data), does it breach a known requirement or leave one unstated? Report in <compliance>, naming the rule. You are flagging items for a compliance team, never certifying compliance.

${STYLE_RULES}

Do NOT summarize the document. Do NOT rewrite the PRD. Avoid generic advice like "add more detail" — every fix must state exactly what information needs to be added, and where possible include a copy-pasteable suggested addition.

Report the most important issues only — at most 5 critical, 4 medium, 3 minor, highest-impact first. Be concise: one or two sentences per field, and do not pad with low-value issues.

${withPatches ? `${PATCH_RULES}\n\n` : ''}Respond with XML ONLY — exactly this structure, no prose outside the tags. Emit the <score> block FIRST so the verdict is captured even in a long response:
<review>
  <score>
    <criticalIssues>count</criticalIssues>
    <mediumIssues>count</mediumIssues>
    <minorIssues>count</minorIssues>
    <readiness>0-100</readiness>
    <decision>Ready to Build | Build with Changes | Needs Major Revision</decision>
    <confidence>High|Medium|Low — how certain YOU are of this assessment (independent of the score)</confidence>
    <rationale>2-4 sentences explaining the score and decision</rationale>
  </score>
  <strengths>
    <item>a part of the PRD that is implementation-ready as written (2-5 items; leave the tag empty if none)</item>
  </strengths>
  <critical>
    <issue>
      <title>short, specific issue title</title>
      <where>the EXACT heading text from the DOCUMENT OUTLINE that the issue falls under, copied verbatim; only when no heading fits, a short verbatim quote from the document</where>
      <why>why it is insufficient</why>
      <impact>the engineering impact</impact>
      <fix>exactly what information must be added</fix>
      <example>optional: a copy-pasteable suggested addition, 1-3 compact lines</example>
      <confidence>High|Medium|Low — how certain you are the issue is real rather than inferred</confidence>${
        withPatches
          ? `
      <patch>
        <action>append | replace</action>
        <kind>paragraph | table | list | heading</kind>
        <targetHeading>the EXACT heading text from the DOCUMENT OUTLINE, copied verbatim</targetHeading>
        <content>the finished, ready-to-paste PRD markdown (see PATCH GENERATION rules)</content>
        <rationale>one sentence — why this text resolves the issue</rationale>
        <confidence>0-100 — how grounded this text is in the document (100 = directly grounded; low = inventing specifics)</confidence>
      </patch>`
          : ''
      }
    </issue>
  </critical>
  <medium>same issue blocks — important but not blocking</medium>
  <minor>same issue blocks — nice-to-have improvements</minor>
  <technical>same issue blocks, but WITHOUT the <patch> element — engineering-soundness gaps: unspecified inputs/outputs, formats, limits, error handling, idempotency, retries, timeouts, data volumes, observability</technical>
  <compliance>same issue blocks, but WITHOUT the <patch> element — a policy or regulatory requirement the document breaches or leaves unstated. State WHICH rule in <why>. Never assert the document IS compliant; these are items for a compliance team to confirm</compliance>
  <requirementGaps>same issue blocks, but WITHOUT the <patch> element — one per explicitly missing requirement</requirementGaps>
  <acceptanceGaps>same issue blocks, but WITHOUT the <patch> element — one per feature lacking measurable acceptance criteria; put the actual suggested criterion in <fix></acceptanceGaps>
  <missing>
    <userFlows><item>each missing user journey</item></userFlows>
    <edgeCases><item>each important edge case the PRD ignores</item></edgeCases>
    <nonFunctional><item>each missing non-functional specification</item></nonFunctional>
  </missing>
  <questions>
    <product><item>behaviour decisions the PM must make</item></product>
    <engineering><item>implementation choices to raise with engineering</item></engineering>
  </questions>
</review>

Critical = blocks engineering from implementing (max 5). Medium = important but not blocking (max 4). Minor = nice-to-have (max 3). Populate <criticalIssues>/<mediumIssues>/<minorIssues> with the counts of issue blocks you produced.

Caps for the other buckets: technical max 5, compliance max 4, requirementGaps max 4, acceptanceGaps max 4. Only <critical>, <medium> and <minor> carry a <patch>; the other four buckets must NOT include one. Do not repeat the same finding in two buckets — pick the single most apt bucket for each.${
    withPatches
      ? ''
      : `

<where> is load-bearing: it is used to locate the exact section this issue belongs to, so copy the heading verbatim from the DOCUMENT OUTLINE whenever one fits.`
  }`
}

/** Review prompt actually used: findings-only while GROUNDED_DRAFTS is on. */
export const PM_REVIEW_SYSTEM = pmReviewSystem(!GROUNDED_DRAFTS)

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

/** Structural hint for Phase-2 apply (replace paragraph / replace table / merge list). Stored only — no logic yet. */
export type PatchKind = 'paragraph' | 'table' | 'list' | 'heading'
const PATCH_KINDS: readonly PatchKind[] = ['paragraph', 'table', 'list', 'heading']

/**
 * A locally-derived anchor for machine-applying a patch. NEVER model-supplied —
 * `anchorPatches` (src/lib/editor/anchor.ts) resolves it against the review-time
 * document map so the AI never decides where the edit lands. Absent = unanchored
 * (Apply disabled; Copy/Retry still work).
 */
export interface PatchAnchor {
  /** Normalized heading identity (normalizeRef ∘ stripSectionPrefix of the resolved heading). */
  heading: string
  /** Resolved DocHeading's verbatim text (for jump/View change). */
  headingText: string
  /** Ancestor heading path (disambiguation at apply time). */
  path: string[]
  /** SHA-256 (hex) of the normalized section text at review time; absent = hash gate skipped. */
  sectionHash?: string
  /**
   * Section body captured at review time (tail-truncated) — the diff preview's
   * "before". Derived locally from the extracted page, never model-supplied.
   * Absent for demo runs and pre-Phase-4 history (preview then shows the
   * addition without surrounding context).
   */
  sectionText?: string
  /** Enclosing Notion data-block-id — session-scope fast path; stale/absent → re-match by heading. */
  headingBlockId?: string
  /** Adjacent heading texts (review-time doc order) — disambiguate duplicate headings on re-match. */
  prevHeading?: string
  nextHeading?: string
}

/**
 * An AI-written, ready-to-paste PRD edit attached to a review issue.
 * Phase 1 generates + edits; Phase 2.5 applies them to Notion via the DOM.
 */
export interface SuggestedPatch {
  /** Patch-format version. v1 = append|replace; future: insertBefore/After, replaceSelection, createSection (v2); table/list/image edits (v3). */
  version: 1
  /** `${severity}-${index}` — stable position-based id (NOT content-derived: edits must never orphan a saved draft). */
  id: string
  /** Phase 1: the parser coerces EVERYTHING to 'append' — replacing a section is only safe once apply-time code inspects it (Phase 2). */
  action: 'append' | 'replace'
  kind: PatchKind
  /** EXACT heading from the DOCUMENT OUTLINE (same convention as `where`, so resolveReference can locate it at apply time). */
  targetHeading: string
  /** Final PRD-ready markdown — prose, never advice. */
  content: string
  rationale: string
  /** 0-100, purely informational — NEVER drives behavior (LLMs self-calibrate poorly). */
  modelConfidence?: number
  /** Locally-derived apply anchor (set by anchorPatches; never from the model). */
  anchor?: PatchAnchor
}

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
  /** AI-written PRD patch for this issue (absent when the model omitted/emptied it or validation dropped it). */
  suggestedPatch?: SuggestedPatch
}

/**
 * The issue buckets, in ONE place.
 *
 * Before this existed, eight files independently hardcoded
 * `[critical, medium, minor]` — `allIssues`, the card loop, `anchorPatches`,
 * `recordGeneratedPatches`, the deep-path finding mapping, analytics, ReviewTab,
 * and the parser. Adding a bucket meant editing all eight, and missing any ONE
 * failed silently: patches that never anchor (Apply permanently disabled), or a
 * dimension the build decision can't see. Everything now derives from here.
 *
 * `inlinePatch: false` means the model reports the issue but does NOT write the
 * draft in the review call. That is a token-budget decision, not a capability one:
 * 12 inline patches already cost 3-5k output tokens against a 9000 cap, so the new
 * dimensions would push the XML into truncation. Those issues are still fully
 * draftable — the "Retry generation" path writes them on demand, grounded in the
 * real section, which produces *better* drafts than the inline path anyway.
 */
export interface IssueBucket {
  /** Field on ReadinessReview. */
  key: IssueBucketKey
  /** XML tag the model emits. patchId is `${tag}-${index}`, so this is also the id prefix. */
  tag: string
  /** Analytics category (joins with buildFindingRecords / CATEGORY_MAP). */
  category: string
  /** Heading prefix in the copy/History card view. */
  cardPrefix: string
  /** Chip label in the panel. */
  chip: string
  /** Card accent in the copy view. */
  tone: Section['tone']
  /** Chip colour in the panel. */
  chipTone: 'rose' | 'amber' | 'sky' | 'blue' | 'emerald' | 'slate'
  /** How many the prompt asks for. */
  cap: number
  /** Whether the review writes the draft inline (see note above). */
  inlinePatch: boolean
  /** Deep-path Finding mapping. */
  findingKind: 'risk' | 'insight' | 'gap'
  findingSeverity: 'high' | 'medium' | 'low'
}

export type IssueBucketKey =
  | 'critical'
  | 'medium'
  | 'minor'
  | 'technical'
  | 'compliance'
  | 'requirementGaps'
  | 'acceptanceGaps'

export const ISSUE_BUCKETS: readonly IssueBucket[] = [
  { key: 'critical', tag: 'critical', category: 'critical', cardPrefix: 'Critical', chip: 'Critical',
    tone: 'risk', chipTone: 'rose', cap: 5, inlinePatch: true, findingKind: 'risk', findingSeverity: 'high' },
  { key: 'compliance', tag: 'compliance', category: 'compliance', cardPrefix: 'Compliance', chip: 'Compliance',
    tone: 'risk', chipTone: 'rose', cap: 4, inlinePatch: false, findingKind: 'risk', findingSeverity: 'high' },
  { key: 'technical', tag: 'technical', category: 'technical', cardPrefix: 'Technical', chip: 'Technical',
    tone: 'unknown', chipTone: 'amber', cap: 5, inlinePatch: false, findingKind: 'gap', findingSeverity: 'medium' },
  { key: 'medium', tag: 'medium', category: 'medium', cardPrefix: 'Medium', chip: 'Medium',
    tone: 'unknown', chipTone: 'amber', cap: 4, inlinePatch: true, findingKind: 'risk', findingSeverity: 'medium' },
  // Renamed away from `requirements`/`acceptanceCriteria`: those tag names also
  // exist inside <missing>, and the parser's blocks() is not container-scoped, so
  // the same tag in two places silently resolves to whichever appears first —
  // yielding zero issues with no error.
  { key: 'requirementGaps', tag: 'requirementGaps', category: 'missing_requirement',
    cardPrefix: 'Missing requirement', chip: 'Missing from PRD', tone: 'unknown', chipTone: 'amber',
    cap: 4, inlinePatch: false, findingKind: 'gap', findingSeverity: 'medium' },
  { key: 'acceptanceGaps', tag: 'acceptanceGaps', category: 'missing_acceptance_criteria',
    cardPrefix: 'Missing AC', chip: 'Missing AC', tone: 'unknown', chipTone: 'sky',
    cap: 4, inlinePatch: false, findingKind: 'gap', findingSeverity: 'medium' },
  { key: 'minor', tag: 'minor', category: 'minor', cardPrefix: 'Minor', chip: 'Minor',
    tone: 'implementation', chipTone: 'sky', cap: 3, inlinePatch: true, findingKind: 'insight', findingSeverity: 'low' },
]

export interface ReadinessReview {
  strengths: string[]
  critical: ReadinessIssue[]
  medium: ReadinessIssue[]
  minor: ReadinessIssue[]
  /**
   * Buckets added in Phase 7. OPTIONAL by necessity: `pm_history` holds 50 stored
   * reviews without them and there is no ErrorBoundary anywhere in src/, so a
   * required field would blank the whole panel when an old review is reopened.
   * `getReview()` normalizes absent buckets to [] so components stay simple.
   */
  technical?: ReadinessIssue[]
  compliance?: ReadinessIssue[]
  requirementGaps?: ReadinessIssue[]
  acceptanceGaps?: ReadinessIssue[]
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

/**
 * Extract and normalize the <patch> of one issue block. Hard rules live HERE,
 * not in the prompt: action is always coerced to 'append' (replace is unsafe
 * until Phase-2 apply inspects the real section), kind falls back to
 * 'paragraph', and modelConfidence is clamped but never gates anything.
 */
function parsePatch(issueBlock: string, id: string): SuggestedPatch | undefined {
  const p = blocks(issueBlock, 'patch')[0]
  if (!p) return undefined
  const content = text(p, 'content')
  const targetHeading = text(p, 'targetHeading')
  // Empty content is the model's idempotency signal ("already covered") — drop.
  if (!content || !targetHeading) return undefined
  const kindRaw = (text(p, 'kind') ?? '').toLowerCase() as PatchKind
  const confidenceNum = Number(text(p, 'confidence'))
  return {
    version: 1,
    id,
    action: 'append',
    kind: PATCH_KINDS.includes(kindRaw) ? kindRaw : 'paragraph',
    targetHeading,
    content,
    rationale: text(p, 'rationale') ?? '',
    modelConfidence: Number.isFinite(confidenceNum)
      ? Math.min(100, Math.max(0, Math.round(confidenceNum)))
      : undefined,
  }
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
      suggestedPatch: parsePatch(b, ''),
    }))
    .filter((i) => i.why || i.fix || i.where)
    // Ids are assigned AFTER filtering so they always equal the issue's final
    // position — the UI derives the same `${severity}-${index}` for issues
    // with no patch (Retry), and drafts key off it, so alignment is identity.
    .map((i, index) =>
      i.suggestedPatch ? { ...i, suggestedPatch: { ...i.suggestedPatch, id: `${tag}-${index}` } } : i,
    )
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
    // Every bucket parsed from ISSUE_BUCKETS — patchIds come out as `${tag}-${n}`.
    ...(Object.fromEntries(
      ISSUE_BUCKETS.map((b) => [b.key, parseIssues(raw, b.tag)]),
    ) as Record<IssueBucketKey, ReadinessIssue[]>),
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

  // 3-5 — Issues, one card each, in ISSUE_BUCKETS order (severity/priority order).
  for (const b of ISSUE_BUCKETS) {
    for (const i of bucketIssues(review, b)) sections.push(issueCard(b.cardPrefix, i, b.tone))
  }

  // 6 — Explicit gaps. Requirements/AC are issue buckets now; these two fields
  // only populate for reviews stored before Phase 7, so old History still renders.
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

// --- SuggestedPatch helpers (validation, stats, per-issue Retry) ---

/** Every issue across every bucket — derived, so a new bucket is never missed. */
export const bucketIssues = (review: ReadinessReview, b: IssueBucket): ReadinessIssue[] =>
  (review[b.key] as ReadinessIssue[] | undefined) ?? []

const allIssues = (review: ReadinessReview): ReadinessIssue[] =>
  ISSUE_BUCKETS.flatMap((b) => bucketIssues(review, b))

/** Same tolerant identity the jump-to-PRD resolver uses: exact normalized or bidirectional substring. */
function headingInOutline(targetHeading: string, normalizedOutline: string[]): boolean {
  const norm = headingKey(targetHeading)
  if (!norm) return false
  return normalizedOutline.some(
    (h) => h.length >= 4 && (h === norm || h.includes(norm) || norm.includes(h)),
  )
}

/** True when a patch target resolves to a real outline heading (or no outline was captured). */
export function patchTargetValid(targetHeading: string, headings: string[]): boolean {
  if (!headings.length) return true
  const outline = headings.map((h) => headingKey(h)).filter(Boolean)
  return headingInOutline(targetHeading, outline)
}

/**
 * Flag patches whose targetHeading is not in the document outline, for logging.
 * NON-DESTRUCTIVE: the patch (and its useful draft text) is kept — an unverified
 * heading only matters at Phase-2 apply time, which re-checks it then; dropping
 * the draft now would hide the whole feature whenever a real page's headings
 * don't exactly match the model's wording. No outline captured → nothing flagged.
 */
export function validatePatches(
  review: ReadinessReview,
  headings: string[],
): Array<{ id: string; targetHeading: string }> {
  if (!headings.length) return []
  const outline = headings.map((h) => headingKey(h)).filter(Boolean)
  const unverified: Array<{ id: string; targetHeading: string }> = []
  for (const issue of allIssues(review)) {
    const patch = issue.suggestedPatch
    if (patch && !headingInOutline(patch.targetHeading, outline)) {
      unverified.push({ id: patch.id, targetHeading: patch.targetHeading })
    }
  }
  return unverified
}

/** Patch metadata for logging/analytics. NEVER includes content (it can echo the PRD). */
export function collectPatchStats(review: ReadinessReview): {
  count: number
  patches: Array<{
    id: string
    kind: PatchKind
    targetHeading: string
    length: number
    modelConfidence?: number
  }>
} {
  const patches = allIssues(review)
    .map((i) => i.suggestedPatch)
    .filter((p): p is SuggestedPatch => Boolean(p))
    .map((p) => ({
      id: p.id,
      kind: p.kind,
      targetHeading: p.targetHeading,
      length: p.content.length,
      modelConfidence: p.modelConfidence,
    }))
  return { count: patches.length, patches }
}

/**
 * Prompt pair for regenerating ONE issue's patch (the UI Retry button) without
 * rerunning the whole review. Same PATCH_RULES as the full review.
 */
export function buildPatchPrompt(
  issue: Pick<ReadinessIssue, 'title' | 'where' | 'why' | 'impact' | 'fix'>,
  outline: string[],
  docText: string,
): { system: string; pageText: string; taskText: string } {
  const system = `You are a Staff Product Manager writing the exact text that resolves one review issue in a Product Requirements Document.

${PATCH_RULES}

Respond with XML ONLY — a single block, no prose outside it:
<patch>
  <action>append | replace</action>
  <kind>paragraph | table | list | heading</kind>
  <targetHeading>the EXACT heading text from the DOCUMENT OUTLINE, copied verbatim</targetHeading>
  <content>the finished, ready-to-paste PRD markdown</content>
  <rationale>one sentence — why this text resolves the issue</rationale>
  <confidence>0-100 — how grounded this text is in the document</confidence>
</patch>`

  const issueLines = [
    `Title: ${issue.title}`,
    issue.where && `Where: ${issue.where}`,
    issue.why && `Why it is insufficient: ${issue.why}`,
    issue.impact && `Engineering impact: ${issue.impact}`,
    issue.fix && `What must be added: ${issue.fix}`,
  ].filter(Boolean)

  const taskText = `DOCUMENT OUTLINE:
${outline.length ? outline.map((h) => `- ${h}`).join('\n') : '(no outline captured)'}

THE ISSUE TO RESOLVE:
${issueLines.join('\n')}

Write the single best patch for this issue in the document above, as the specified <patch> XML.`

  return { system, pageText: docText, taskText }
}

/**
 * Grounded variant of buildPatchPrompt: the target section is RESOLVED by the
 * navigation engine before this call, so the model NEVER chooses a heading — it
 * only writes the body for the given section (see the Phase-3 safety model).
 * `sectionText` is the extracted text of that one section; the model returns
 * content/rationale/confidence only — no <targetHeading>.
 */
export function buildGroundedPatchPrompt(
  issue: Pick<ReadinessIssue, 'title' | 'where' | 'why' | 'impact' | 'fix'>,
  view: SectionView,
): { system: string; pageText: string; taskText: string } {
  // Structure-aware guidance derived from the section itself. This is what makes
  // the model extend an existing list instead of re-declaring the heading.
  const shape = view.isEmpty
    ? 'The section is empty — write its body from scratch.'
    : view.hasList
      ? `The section already contains a list. EXTEND it: emit only new items in the same style (bullet marker "${view.bulletMarker ?? '-'}"), never a new heading and never a restatement of existing items.`
      : 'The section already contains prose. Add only the missing content, in the same voice and formatting; do not restate what is there.'

  const system = `You are a Staff Product Manager writing the exact text that resolves one review issue in a Product Requirements Document.

The target section is FIXED and its CURRENT CONTENT is shown to you, line by line with block types. Do NOT choose or emit a heading; write ONLY the body that belongs in that section.

${shape}

${PATCH_RULES}

Respond with XML ONLY — a single block, no prose outside it, and NO <targetHeading> tag:
<patch>
  <action>append | replace</action>
  <kind>paragraph | table | list | heading</kind>
  <content>the finished, ready-to-paste PRD markdown for the fixed section above</content>
  <rationale>one sentence — why this text resolves the issue</rationale>
  <confidence>0-100 — how grounded this text is in the document</confidence>
</patch>`

  const issueLines = [
    `Title: ${issue.title}`,
    issue.why && `Why it is insufficient: ${issue.why}`,
    issue.impact && `Engineering impact: ${issue.impact}`,
    issue.fix && `What must be added: ${issue.fix}`,
  ].filter(Boolean)

  const rendered = renderSectionView(view)

  const taskText = `${rendered}

THE ISSUE TO RESOLVE:
${issueLines.join('\n')}

Write the single best patch body for the fixed section above, as the specified <patch> XML (no <targetHeading>).`

  return { system, pageText: rendered, taskText }
}

/**
 * One bounded repair pass. The deterministic validators found concrete problems
 * (duplicated line, leaked instruction, invented heading, wrong bullet marker), so
 * we name them and ask for a corrected draft — rather than paying a model to grade
 * its own prose, which is both unreliable and twice the cost.
 */
export function buildRepairPrompt(
  previous: string,
  violations: Array<{ message: string }>,
  view: SectionView,
): { system: string; pageText: string; taskText: string } {
  const system = `You are a Staff Product Manager correcting a draft addition to a Product Requirements Document.

The draft below was rejected by automated checks. Fix EXACTLY the listed problems and change nothing else. Do not explain; return only the corrected patch.

${PATCH_RULES}

Respond with XML ONLY — a single block, no prose outside it, and NO <targetHeading> tag:
<patch>
  <action>append | replace</action>
  <kind>paragraph | table | list | heading</kind>
  <content>the corrected, ready-to-paste PRD markdown</content>
  <rationale>one sentence — why this text resolves the issue</rationale>
  <confidence>0-100</confidence>
</patch>`

  const rendered = renderSectionView(view)

  const taskText = `${rendered}

THE REJECTED DRAFT:
${previous}

PROBLEMS THAT MUST BE FIXED:
${violations.map((v, n) => `${n + 1}. ${v.message}`).join('\n')}

Return the corrected patch.`

  return { system, pageText: rendered, taskText }
}

/**
 * Parse a grounded Retry response. The model omits <targetHeading> (the section
 * was resolved locally), so the caller passes the known headingText and it is
 * injected here — the model never picked the location.
 */
export function parseGroundedPatch(
  rawInput: string,
  id: string,
  headingText: string,
): SuggestedPatch | undefined {
  const raw = rawInput
    .trim()
    .replace(/^```(?:xml)?\s*/i, '')
    .replace(/```$/, '')
  // Reuse the same body parser by re-injecting the known heading into the block.
  const p = blocks(raw, 'patch')[0]
  if (!p) return undefined
  const withHeading = p.includes('<targetHeading>')
    ? `<patch>${p}</patch>`
    : `<patch>${p}<targetHeading>${headingText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</targetHeading></patch>`
  return parsePatch(withHeading, id)
}

/** Parse the Retry response: one <patch> block. The caller supplies the stable id. */
export function parseSinglePatch(rawInput: string, id: string): SuggestedPatch | undefined {
  const raw = rawInput
    .trim()
    .replace(/^```(?:xml)?\s*/i, '')
    .replace(/```$/, '')
  return parsePatch(raw, id)
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
  maxPageChars: (depth) => REVIEW_PAGE_CHARS[depth],
  // Findings-first (GROUNDED_DRAFTS): no patch prose rides along, so the review
  // needs roughly half the output budget — which is also why it returns sooner.
  // With patches inline, up to 12 of them add +3-5k output tokens.
  // <score>-first ordering keeps the verdict safe even if a long tail truncates.
  maxTokens: (depth) =>
    GROUNDED_DRAFTS
      ? depth === 'quick'
        ? 3000
        : depth === 'deep'
          ? 6000
          : 4500
      : depth === 'quick'
        ? 6000
        : depth === 'deep'
          ? 12000
          : 9000,
  systemInstructions: PM_REVIEW_SYSTEM,
  buildTask: () =>
    'Review the PRD below against any USER & REVIEW CONTEXT provided above it, and return the implementation-readiness review as the specified XML.',
  parse: parsePmReview,
}
