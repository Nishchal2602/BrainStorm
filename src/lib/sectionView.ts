import type { DocHeading } from '@/lib/navigation'
import { headingKey } from '@/lib/navigation'

/**
 * Distinctive fragment of pageContext's TRUNC_MARKER
 * ("\n\n[… middle of document omitted to fit budget …]\n\n"). Matched as a
 * substring so the two stay decoupled — a section scan must never run past it.
 */
const TRUNC_MARKER_TEXT = 'middle of document omitted'

// A line-indexed, type-annotated view of ONE section of the document.
//
// This exists because of a concrete defect: the review prompt sends a head/tail
// TRUNCATED document (8k chars at the default depth, middle replaced by a marker),
// while instructing the model to "read the target section's existing text" and
// "preserve bullet style". When the target section falls in the omitted middle the
// model cannot comply, so it invents a plausible section — which is exactly why
// drafts duplicate headings and repeat content. The fix is not more prompt text;
// it is showing the model the real section.
//
// Lines are numbered so the model can reference a position (L3) without ever
// handling a provider id. Mapping a line back to a block stays deterministic.

export type SectionLineType =
  | 'heading'
  | 'paragraph'
  | 'bulleted_list_item'
  | 'numbered_list_item'
  | 'quote'
  | 'code'
  | 'table_row'
  | 'empty'

export interface SectionLine {
  /** 1-based line number WITHIN the section (stable only for this snapshot). */
  i: number
  type: SectionLineType
  text: string
}

export interface SectionView {
  headingText: string
  headingLevel: number
  /** Position of the heading in the document outline, for orientation. */
  index: number
  total: number
  /** Ancestor headings, outermost first. */
  ancestors: string[]
  prevHeading?: string
  nextHeading?: string
  lines: SectionLine[]
  /** True when the section has a bullet/numbered run the draft should extend. */
  hasList: boolean
  /** True when the section has no meaningful content (heading only). */
  isEmpty: boolean
  /** Bullet marker the section actually uses ('-' | '*' | '+'), when it has one. */
  bulletMarker?: string
}

/**
 * Line range of one section in the extracted content: (start, end) exclusive of
 * the heading line itself. The SINGLE implementation of section slicing —
 * `sectionTextFor` in editor/anchor.ts delegates here so the two can never drift.
 *
 * Note headings are matched by NORMALIZED TEXT, not by a `#` prefix: the page
 * extractor emits real `<h1-6>` tags as `## …` but Notion's div-based headings
 * come through as plain lines, so prefix matching would miss every Notion doc.
 */
export function sectionLineRange(
  content: string,
  headings: DocHeading[],
  index: number,
): { start: number; end: number } | undefined {
  const target = headings[index]
  if (!target) return undefined
  const normTarget = headingKey(target.text)
  if (!normTarget) return undefined

  const lines = content.split('\n')
  const headingNorms = new Set(headings.map((h) => headingKey(h.text)).filter(Boolean))

  // headingKey on BOTH sides — comparing a prefix-stripped target against an
  // unstripped line made every numbered heading ("11.1 Workout Generation")
  // unresolvable, which silently disabled section text, hashing and grounding.
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (headingKey(lines[i]) === normTarget) {
      start = i
      break
    }
  }
  if (start === -1) return undefined

  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    // The truncation marker is a hard boundary: past it the text belongs to a
    // different part of the document, and headings living only in the omitted
    // middle can never match — so a scan that crossed it would splice unrelated
    // tail prose into this section (and into its hash and diff preview).
    if (lines[i].includes(TRUNC_MARKER_TEXT)) {
      end = i
      break
    }
    const n = headingKey(lines[i])
    if (n && n !== normTarget && headingNorms.has(n)) {
      end = i
      break
    }
  }
  return { start, end }
}

const BULLET_RE = /^\s*([-*+])\s+(.*)$/
const NUMBERED_RE = /^\s*\d+[.)]\s+(.*)$/
const HEADING_RE = /^\s*(#{1,6})\s+(.*)$/
const QUOTE_RE = /^\s*>\s?(.*)$/
const TABLE_RE = /^\s*\|.*\|\s*$/

/** Classify one extracted-markdown line. `headingNorms` catches bare-text (Notion) headings. */
function classify(line: string, headingNorms: Set<string>): SectionLineType {
  if (!line.trim()) return 'empty'
  if (HEADING_RE.test(line)) return 'heading'
  if (BULLET_RE.test(line)) return 'bulleted_list_item'
  if (NUMBERED_RE.test(line)) return 'numbered_list_item'
  if (QUOTE_RE.test(line)) return 'quote'
  if (TABLE_RE.test(line)) return 'table_row'
  // A bare line whose heading key is a known heading is a Notion-style heading.
  if (headingNorms.has(headingKey(line))) return 'heading'
  return 'paragraph'
}

/**
 * Build the view for `headings[index]`. Returns undefined when the section's
 * heading line can't be located in the extracted content (truncated middle,
 * heading rendered differently) — callers then fall back to the outline prompt.
 */
export function buildSectionView(
  content: string,
  headings: DocHeading[],
  index: number,
): SectionView | undefined {
  const range = sectionLineRange(content, headings, index)
  const target = headings[index]
  if (!range || !target) return undefined

  const headingNorms = new Set(headings.map((h) => headingKey(h.text)).filter(Boolean))
  const raw = content.split('\n').slice(range.start + 1, range.end)

  // Trim leading/trailing blank lines — they are extraction noise, not structure.
  let from = 0
  let to = raw.length
  while (from < to && !raw[from].trim()) from++
  while (to > from && !raw[to - 1].trim()) to--

  const lines: SectionLine[] = raw.slice(from, to).map((text, n) => ({
    i: n + 1,
    type: classify(text, headingNorms),
    text: text.trim(),
  }))

  const bulletLine = raw.slice(from, to).find((l) => BULLET_RE.test(l))
  const bulletMarker = bulletLine?.match(BULLET_RE)?.[1]

  return {
    headingText: target.text,
    headingLevel: target.level,
    index,
    total: headings.length,
    ancestors: target.path,
    prevHeading: headings[index - 1]?.text,
    nextHeading: headings[index + 1]?.text,
    lines,
    hasList: lines.some(
      (l) => l.type === 'bulleted_list_item' || l.type === 'numbered_list_item',
    ),
    isEmpty: lines.every((l) => l.type === 'empty'),
    bulletMarker,
  }
}

/**
 * Render the view as a prompt block. Types are shown explicitly so the model can
 * see that (say) a bullet run already exists and extend it instead of inventing a
 * duplicate heading.
 */
export function renderSectionView(view: SectionView): string {
  const head = [
    `TARGET SECTION — "${view.headingText}" (heading level ${view.headingLevel}, section ${view.index + 1} of ${view.total})`,
    view.ancestors.length ? `Within: ${view.ancestors.join(' ▸ ')}` : undefined,
    view.prevHeading ? `Preceded by: "${view.prevHeading}"` : undefined,
    view.nextHeading ? `Followed by: "${view.nextHeading}"` : undefined,
  ].filter(Boolean)

  const body = view.isEmpty
    ? '  (this section is currently empty — it has a heading and no content)'
    : view.lines
        .map((l) => `  L${l.i}  ${l.type.padEnd(19)} ${l.text ? JSON.stringify(l.text) : ''}`)
        .join('\n')

  return `${head.join('\n')}

CURRENT CONTENT OF THAT SECTION (numbered, with block types):
${body}`
}
