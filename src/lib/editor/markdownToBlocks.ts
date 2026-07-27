// Minimal Markdown → Notion block JSON. Deliberately NOT a full markdown parser:
// rich text is PLAIN TEXT (inline **bold** / `code` / links are flattened) — that
// covers PRD-patch prose well and avoids a parser rabbit hole. Block-level
// structure (headings, bullets, numbered lists, quotes, code, paragraphs) IS
// preserved, since that's what makes a pasted patch read correctly. Tables land
// as plain paragraphs (lossless text). Enforces Notion's API limits.

const MAX_RICH_TEXT = 2000 // chars per rich_text item (Notion hard limit)

/** A Notion block create-object. Loosely typed — shape matches the append-children API. */
export interface NotionBlock {
  object: 'block'
  type: string
  [key: string]: unknown
}

type BlockType =
  | 'paragraph'
  | 'heading_1'
  | 'heading_2'
  | 'heading_3'
  | 'bulleted_list_item'
  | 'numbered_list_item'
  | 'quote'
  | 'code'

/** Split a string into ≤2000-char rich_text runs (Notion rejects longer). */
function richText(content: string): Array<{ type: 'text'; text: { content: string } }> {
  const text = content.trim()
  if (!text) return []
  if (text.length <= MAX_RICH_TEXT) return [{ type: 'text', text: { content: text } }]
  const parts: Array<{ type: 'text'; text: { content: string } }> = []
  for (let i = 0; i < text.length; i += MAX_RICH_TEXT) {
    parts.push({ type: 'text', text: { content: text.slice(i, i + MAX_RICH_TEXT) } })
  }
  return parts
}

function block(type: BlockType, content: string, extra?: Record<string, unknown>): NotionBlock {
  return { object: 'block', type, [type]: { rich_text: richText(content), ...extra } }
}

/** True for a blank line (paragraph separator). */
const isBlank = (l: string): boolean => l.trim().length === 0

export function markdownToBlocks(md: string): NotionBlock[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const blocks: NotionBlock[] = []

  let i = 0
  let paragraph: string[] = []
  const flushParagraph = (): void => {
    const text = paragraph.join(' ').trim()
    if (text) blocks.push(block('paragraph', text))
    paragraph = []
  }

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block: ``` … ``` (language after the opening fence is ignored).
    const fence = line.match(/^```(.*)$/)
    if (fence) {
      flushParagraph()
      const lang = fence[1].trim().toLowerCase()
      const code: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++])
      i++ // consume the closing fence
      blocks.push(
        block('code', code.join('\n'), { language: NOTION_LANGS.has(lang) ? lang : 'plain text' }),
      )
      continue
    }

    if (isBlank(line)) {
      flushParagraph()
      i++
      continue
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/)
    if (heading) {
      flushParagraph()
      const level = heading[1].length as 1 | 2 | 3
      blocks.push(block(`heading_${level}` as BlockType, heading[2]))
      i++
      continue
    }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/)
    if (bullet) {
      flushParagraph()
      blocks.push(block('bulleted_list_item', bullet[1]))
      i++
      continue
    }

    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (numbered) {
      flushParagraph()
      blocks.push(block('numbered_list_item', numbered[1]))
      i++
      continue
    }

    const quote = line.match(/^\s*>\s?(.*)$/)
    if (quote) {
      flushParagraph()
      blocks.push(block('quote', quote[1]))
      i++
      continue
    }

    // Plain text — accumulate into the current paragraph (wrapped lines merge).
    paragraph.push(line.trim())
    i++
  }
  flushParagraph()
  return blocks
}

// Notion's accepted code-block languages are a fixed set; anything else → 'plain text'.
const NOTION_LANGS = new Set([
  'bash', 'c', 'c#', 'c++', 'css', 'diff', 'go', 'graphql', 'html', 'java', 'javascript',
  'json', 'kotlin', 'markdown', 'php', 'plain text', 'python', 'ruby', 'rust', 'shell',
  'sql', 'swift', 'typescript', 'xml', 'yaml',
])
