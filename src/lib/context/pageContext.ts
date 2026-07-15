import type { DetectedSource, PageContext } from '@/lib/types'
import type { DocHeading } from '@/lib/navigation'

const DEFAULT_MAX_CHARS = 12_000

export interface RawExtract {
  url: string
  title: string
  content: string
  selection: string
  /** Compact h1–h3 table-of-contents (structure map), may be absent. */
  outline?: string
  /** Best-effort source-specific key/value fields (e.g. Jira status/priority). */
  fields?: Array<{ label: string; value: string }>
  /** Full heading map (level/text/anchor id/path) for jump-to-section navigation. */
  headings?: DocHeading[]
}

function normalize(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const TRUNC_MARKER = '\n\n[… middle of document omitted to fit budget …]\n\n'

/**
 * Keep the head (~65%) AND tail (~35%) of long content, snapped to newline
 * boundaries, with a visible marker between them. End-of-doc material (success
 * metrics, risks, open questions, conclusions) survives instead of being cut
 * by a head-only slice. Deterministic → cache-friendly.
 */
function headTailTruncate(text: string, max: number): string {
  if (text.length <= max) return text
  const budget = max - TRUNC_MARKER.length
  if (budget <= 0) return text.slice(0, max)
  const tailLen = Math.floor(budget * 0.35)
  const headLen = budget - tailLen

  let head = text.slice(0, headLen)
  const lastNl = head.lastIndexOf('\n')
  if (lastNl > headLen * 0.5) head = head.slice(0, lastNl)

  let tail = text.slice(text.length - tailLen)
  const firstNl = tail.indexOf('\n')
  if (firstNl > -1 && firstNl < tailLen * 0.5) tail = tail.slice(firstNl + 1)

  return head + TRUNC_MARKER + tail
}

export function buildPageContext(
  raw: RawExtract,
  source: DetectedSource,
  maxChars: number = DEFAULT_MAX_CHARS,
): PageContext {
  const content = normalize(raw.content)
  const truncated = content.length > maxChars
  return {
    url: raw.url,
    title: raw.title || 'Untitled',
    source,
    selection: normalize(raw.selection).slice(0, 4000),
    content: truncated ? headTailTruncate(content, maxChars) : content,
    truncated,
    outline: raw.outline ? normalize(raw.outline) : undefined,
    fields: raw.fields?.length ? raw.fields : undefined,
    headings: raw.headings?.length ? raw.headings : undefined,
  }
}

/** Renders the captured page into a prompt block for the user turn. */
export function contextToPromptBlock(ctx: PageContext): string {
  const parts: string[] = []
  parts.push(`PAGE TITLE: ${ctx.title}`)
  parts.push(`PAGE URL: ${ctx.url}`)
  parts.push(`DETECTED SOURCE: ${ctx.source}`)
  if (ctx.fields?.length) {
    const lines = ctx.fields.map((f) => `- ${f.label}: ${f.value}`).join('\n')
    parts.push(`\nKEY FIELDS (extracted from the page):\n${lines}`)
  }
  if (ctx.outline) {
    parts.push(`\nDOCUMENT OUTLINE (headings — for structure; full text below):\n${ctx.outline}`)
  }
  if (ctx.selection) {
    parts.push(`\nUSER-SELECTED TEXT (treat as the primary focus):\n${ctx.selection}`)
  }
  parts.push(
    `\nPAGE CONTENT (Markdown — # headings, - lists, | tables):\n${ctx.content || '(no extractable text content)'}`,
  )
  if (ctx.truncated) {
    parts.push(
      ctx.outline
        ? '\n[Note: the middle of the page was omitted to fit the budget; the outline above lists all sections.]'
        : '\n[Note: the middle of the page was omitted to fit the budget; the start and end are preserved.]',
    )
  }
  return parts.join('\n')
}
