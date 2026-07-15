import type { RawExtract } from '@/lib/context/pageContext'

/**
 * Self-contained page extractor. Injected into the active tab via
 * chrome.scripting.executeScript({ func: extractFromPage }), so it MUST NOT
 * reference any module-scope imports — only the type annotation is erased and
 * every helper lives nested inside the function body.
 *
 * Strategy: pick the main content region, walk the LIVE DOM into compact
 * Markdown (preserving headings / lists / tables), build a headings outline,
 * and pull best-effort source-specific KEY FIELDS. The whole structured path is
 * wrapped in try/catch with a plain-innerText fallback, so it is never worse
 * than a flat-text extraction.
 *
 * Note: we walk the attached DOM (not a detached clone) because innerText on a
 * detached node has no layout and returns unreliable text.
 */
export function extractFromPage(): RawExtract {
  const selection = (window.getSelection?.()?.toString() ?? '').trim()

  const MAX_TABLE_ROWS = 30
  const MAX_CELL_CHARS = 200
  const MAX_OUTLINE_ITEMS = 60
  const MAX_OUTLINE_CHARS = 1500
  const MAX_FIELD_CHARS = 200
  const MAX_FIELDS = 10

  const pickRoot = (): HTMLElement => {
    const candidates = [
      'main',
      'article',
      '[role="main"]',
      '#main',
      '.main-content',
      '[data-testid="issue.views.issue-details"]', // Jira
      '.notion-page-content', // Notion
      '.kix-appview-editor', // Google Docs
    ]
    for (const sel of candidates) {
      const el = document.querySelector(sel) as HTMLElement | null
      if (el && (el.innerText?.trim().length ?? 0) > 200) return el
    }
    return document.body
  }

  // Boilerplate that should never contribute to content.
  const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|SVG|IFRAME|NAV|HEADER|FOOTER|ASIDE)$/
  const skippable = (el: HTMLElement): boolean =>
    SKIP.test(el.tagName) ||
    el.getAttribute('aria-hidden') === 'true' ||
    el.getAttribute('role') === 'navigation'

  const inlineText = (el: HTMLElement): string =>
    (el.innerText ?? '').replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim()

  const hasBlockChild = (el: HTMLElement): boolean =>
    el.querySelector(
      'p,div,ul,ol,table,h1,h2,h3,h4,h5,h6,li,section,article,blockquote,pre,figure',
    ) != null

  // Inline tags whose text belongs on the same line as their parent block.
  const INLINE =
    /^(A|ABBR|B|BDI|BDO|CITE|CODE|DATA|DFN|EM|I|KBD|MARK|Q|S|SAMP|SMALL|SPAN|STRONG|SUB|SUP|TIME|U|VAR|LABEL|OUTPUT)$/

  // Inline-only text of an element (text nodes + inline descendants), space-joined
  // so adjacent inline elements don't get glued together. Block children are
  // deliberately excluded — they are walked separately so their structure
  // (nested lists, tables, code, blockquotes) is preserved, not flattened.
  const inlineOnly = (el: HTMLElement): string => {
    const frags: string[] = []
    for (const c of Array.from(el.childNodes)) {
      if (c.nodeType === Node.TEXT_NODE) {
        const t = (c.textContent ?? '').replace(/\s+/g, ' ').trim()
        if (t) frags.push(t)
      } else if (c instanceof HTMLElement && INLINE.test(c.tagName)) {
        const t = (c.innerText ?? '').replace(/\s+/g, ' ').trim()
        if (t) frags.push(t)
      }
    }
    return frags.join(' ').replace(/\s+/g, ' ').trim()
  }

  const cleanCell = (el: HTMLElement): string =>
    (el.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_CELL_CHARS)

  const tableToMd = (table: HTMLElement): string => {
    // Scope to this table's own rows/cells so a nested table isn't absorbed.
    const rows = Array.from(
      table.querySelectorAll(
        ':scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr, :scope > tr',
      ),
    )
    if (!rows.length) return ''
    const out: string[] = []
    const limit = Math.min(rows.length, MAX_TABLE_ROWS)
    for (let i = 0; i < limit; i++) {
      const cells = Array.from(rows[i].querySelectorAll(':scope > th, :scope > td')).map((c) =>
        cleanCell(c as HTMLElement),
      )
      if (!cells.length) continue
      out.push('| ' + cells.join(' | ') + ' |')
      if (out.length === 1) out.push('| ' + cells.map(() => '---').join(' | ') + ' |')
    }
    if (rows.length > limit) out.push(`| …(${rows.length - limit} more rows) |`)
    return out.join('\n')
  }

  const LEAF = /^(P|DIV|SECTION|ARTICLE|FIGCAPTION|DD|DT|TD|TH)$/

  const walk = (node: Node, out: string[], depth: number): void => {
    if (!(node instanceof HTMLElement)) return
    if (skippable(node)) return
    const tag = node.tagName

    if (/^H[1-6]$/.test(tag)) {
      const t = inlineText(node)
      if (t) out.push('\n' + '#'.repeat(Math.min(Number(tag[1]), 6)) + ' ' + t + '\n')
      return
    }
    if (tag === 'UL' || tag === 'OL') {
      let i = 1
      for (const li of Array.from(node.children)) {
        if (li.tagName !== 'LI') continue
        const marker = tag === 'OL' ? `${i++}.` : '-'
        const t = inlineOnly(li as HTMLElement)
        if (t) out.push('  '.repeat(depth) + marker + ' ' + t)
        // Block children (nested lists at any wrapping depth, tables, code,
        // blockquotes, paragraphs) keep their structure via their own handlers,
        // indented one level deeper.
        for (const child of Array.from(li.children)) {
          if (!INLINE.test(child.tagName)) walk(child, out, depth + 1)
        }
      }
      out.push('')
      return
    }
    if (tag === 'TABLE') {
      const md = tableToMd(node)
      if (md) out.push('\n' + md + '\n')
      return
    }
    if (tag === 'BLOCKQUOTE') {
      const t = inlineText(node)
      if (t) out.push('> ' + t.replace(/\n/g, '\n> '))
      return
    }
    if (tag === 'PRE') {
      const t = (node.innerText ?? '').trim()
      if (t) out.push('```\n' + t + '\n```')
      return
    }
    // A block element with no block-level children is a leaf paragraph.
    if (LEAF.test(tag) && !hasBlockChild(node)) {
      const t = inlineText(node)
      if (t) out.push(t)
      return
    }
    // Container — recurse into children.
    for (const c of Array.from(node.childNodes)) walk(c, out, depth)
  }

  const toMarkdown = (root: HTMLElement): string => {
    const out: string[] = []
    walk(root, out, 0)
    return out
      .join('\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  const buildOutline = (root: HTMLElement): string => {
    const lines: string[] = []
    for (const h of Array.from(root.querySelectorAll('h1,h2,h3'))) {
      const el = h as HTMLElement
      if (el.closest('nav,header,footer,aside')) continue
      const t = (el.innerText ?? '').replace(/\s+/g, ' ').trim()
      if (!t) continue
      lines.push('  '.repeat(Number(el.tagName[1]) - 1) + '- ' + t)
      if (lines.length >= MAX_OUTLINE_ITEMS) break
    }
    return lines.join('\n').slice(0, MAX_OUTLINE_CHARS)
  }

  // Document map for jump-to-section navigation: every heading with its level,
  // text, best-available DOM anchor id, and ancestor-heading path. The id makes
  // later lookup exact; text+path make it resilient when ids are absent/changed.
  const MAX_HEADINGS = 150
  const headingAnchorId = (el: HTMLElement): string | undefined => {
    if (el.id) return el.id
    // Anchor inside the heading (GitHub/Confluence style <h2><a id="…">…</a></h2>).
    const inner = el.querySelector('a[id], [id]') as HTMLElement | null
    if (inner?.id) return inner.id
    // Named anchor immediately preceding the heading (<a id="…"></a><h2>…).
    const prev = el.previousElementSibling as HTMLElement | null
    if (prev && prev.id && (prev.innerText ?? '').trim().length === 0) return prev.id
    // A tightly-wrapping parent with an id (Notion blocks, Confluence wrappers).
    const parent = el.parentElement
    if (parent && parent.id && parent.children.length <= 3) return parent.id
    return undefined
  }
  const buildHeadings = (
    root: HTMLElement,
  ): Array<{ level: number; text: string; id?: string; path: string[] }> => {
    const out: Array<{ level: number; text: string; id?: string; path: string[] }> = []
    // Stack of ancestor heading texts by level (path[0] = nearest h1 above, …).
    const stack: string[] = []
    for (const h of Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6'))) {
      const el = h as HTMLElement
      if (el.closest('nav,header,footer,aside')) continue
      const text = (el.innerText ?? '').replace(/\s+/g, ' ').trim()
      if (!text) continue
      const level = Number(el.tagName[1])
      stack.length = Math.max(0, level - 1)
      out.push({ level, text, id: headingAnchorId(el), path: stack.filter(Boolean).slice(0, 4) })
      stack[level - 1] = text
      if (out.length >= MAX_HEADINGS) break
    }
    return out
  }

  // --- Source-specific KEY FIELDS (best-effort; selectors are inherently
  // brittle on obfuscated SPAs, so any miss just yields fewer fields). ---
  const detectSrc = (): string => {
    const host = location.hostname
    const path = location.pathname
    if (host.endsWith('notion.so') || host.endsWith('notion.site')) return 'notion'
    if (host === 'linear.app' || host.endsWith('.linear.app')) return 'linear'
    if (host === 'docs.google.com') return 'gdocs'
    if (host.endsWith('atlassian.net') || host.includes('jira') || host.includes('confluence')) {
      if (path.startsWith('/wiki') || host.includes('confluence')) return 'confluence'
      return 'jira'
    }
    return 'generic'
  }

  const grab = (sels: string[]): string => {
    for (const s of sels) {
      try {
        const el = document.querySelector(s) as HTMLElement | null
        const t = el?.innerText?.replace(/\s+/g, ' ').trim()
        if (t) return t.slice(0, MAX_FIELD_CHARS)
      } catch {
        /* invalid/unsupported selector — skip */
      }
    }
    return ''
  }

  const extractFields = (src: string): Array<{ label: string; value: string }> => {
    const specs: Record<string, Array<[string, string[]]>> = {
      jira: [
        ['Status', ['[data-testid*="status"] [role="button"]', '[data-testid*="issue.fields.status"]']],
        ['Type', ['[data-testid*="issue-type"]', '[data-testid*="issuetype"]']],
        ['Priority', ['[data-testid*="priority"]']],
        ['Assignee', ['[data-testid*="assignee"]']],
        ['Labels', ['[data-testid*="labels"]']],
      ],
      confluence: [
        ['Space', ['[data-testid*="space-name"]', '#space-menu-title']],
        ['Labels', ['[data-testid*="labels"]', '.label-list']],
      ],
      linear: [
        ['Status', ['button[aria-label*="status" i]', '[aria-label*="status" i] button']],
        ['Priority', ['button[aria-label*="priority" i]', '[aria-label*="priority" i] button']],
      ],
      gdocs: [['Doc title', ['.docs-title-input']]],
      notion: [],
      generic: [],
    }
    const fields: Array<{ label: string; value: string }> = []
    for (const [label, sels] of specs[src] ?? []) {
      const v = grab(sels)
      if (v) fields.push({ label, value: v })
      if (fields.length >= MAX_FIELDS) break
    }
    return fields
  }

  // --- Assemble ---
  const root = pickRoot()

  let content = ''
  let outline = ''
  let headings: Array<{ level: number; text: string; id?: string; path: string[] }> = []
  try {
    content = toMarkdown(root)
    outline = buildOutline(root)
  } catch {
    content = ''
  }
  try {
    headings = buildHeadings(root)
  } catch {
    headings = []
  }
  if (content.length < 100) {
    // Fallback: plain text from the region, then the whole body.
    const regionText = (root.innerText ?? '').trim()
    content = regionText.length >= 100 ? regionText : (document.body?.innerText ?? '').trim()
  }

  let fields: Array<{ label: string; value: string }> = []
  try {
    fields = extractFields(detectSrc())
  } catch {
    fields = []
  }

  return {
    url: location.href,
    title: document.title,
    content,
    selection,
    outline: outline || undefined,
    fields: fields.length ? fields : undefined,
    headings: headings.length ? headings : undefined,
  }
}
