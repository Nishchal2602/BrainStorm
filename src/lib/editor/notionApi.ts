import { matchHeading, normalizeRef, stripSectionPrefix, STRICT_MATCH } from '@/lib/navigation'
import type { DocumentEditor, ApplyContext } from './editor'
import type { ApplyResult } from './types'
import { markdownToBlocks } from './markdownToBlocks'

// NotionApiEditor — inserts a patch into a live Notion page via the official
// REST API (append block children). Runs in the service worker, which has host
// permission for api.notion.com and so bypasses page CORS. The heading is still
// resolved LOCALLY from the review-time anchor (the model never picks the target);
// this editor only maps that anchor to a concrete block id and appends after it.

const API = 'https://api.notion.com'
const NOTION_VERSION = '2022-06-28'
const MAX_CHILDREN = 100 // Notion append-children limit per request

/** Typed error carrying an ApplyResult code (mapped to a user message at the boundary). */
class NotionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

interface NBlock {
  id: string
  type: string
  has_children?: boolean
  parent?: { type: string; page_id?: string; block_id?: string }
  [key: string]: unknown
}

const HEADING_TYPES = new Set(['heading_1', 'heading_2', 'heading_3'])
const isHeading = (b: NBlock): boolean => HEADING_TYPES.has(b.type)
const headingLevel = (b: NBlock): number => Number(b.type.split('_')[1]) || 1

/** Plain text of a block from its rich_text array (whatever the block type). */
function plainText(b: NBlock): string {
  const payload = b[b.type] as { rich_text?: Array<{ plain_text?: string; text?: { content?: string } }> } | undefined
  const rt = payload?.rich_text ?? []
  return rt
    .map((r) => r.plain_text ?? r.text?.content ?? '')
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Dashless 32-hex → 8-4-4-4-12 UUID (Notion block/page ids). */
function toUuid(id: string): string {
  const hex = id.replace(/-/g, '')
  if (hex.length !== 32) return id
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Extract the page id from a Notion URL (trailing 32-hex in the path) → UUID. */
function pageIdFromUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname
    const matches = path.match(/[0-9a-f]{32}/gi)
    return matches?.length ? toUuid(matches[matches.length - 1]) : null
  } catch {
    return null
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Retry-After (seconds) from a 429, clamped to something a user will wait through. */
function retryAfterMs(res: Response): number {
  const header = Number(res.headers.get('retry-after'))
  const ms = Number.isFinite(header) && header > 0 ? header * 1000 : 1000
  return Math.min(ms, 5000)
}

export class NotionApiEditor implements DocumentEditor {
  constructor(private readonly token: string) {}

  canHandle(url: string): boolean {
    try {
      const host = new URL(url).hostname.toLowerCase()
      return host.endsWith('notion.so') || host.endsWith('notion.site') || host.endsWith('notion.com')
    } catch {
      return false
    }
  }

  async applyPatch(ctx: ApplyContext): Promise<ApplyResult> {
    if (ctx.action === 'replace') {
      return {
        success: false,
        code: 'REPLACE_UNSUPPORTED',
        reason: "Replace isn't available yet — only appending new content is supported.",
      }
    }
    try {
      const heading = await this.resolveHeading(ctx)
      const parentId = this.parentIdOf(heading, ctx.url)
      const siblings = await this.listChildren(parentId)

      // Section span: from the heading to the next same-or-higher-level heading.
      const hIdx = siblings.findIndex((b) => b.id === heading.id)
      if (hIdx === -1) throw new NotionError('HEADING_NOT_FOUND', 'Heading not found under its parent.')
      const startLevel = headingLevel(siblings[hIdx])
      let end = siblings.length
      for (let j = hIdx + 1; j < siblings.length; j++) {
        if (isHeading(siblings[j]) && headingLevel(siblings[j]) <= startLevel) {
          end = j
          break
        }
      }
      const span = siblings.slice(hIdx + 1, end)

      // Duplicate check — is the draft's first line already in this section?
      const firstLine = ctx.body.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
      if (firstLine) {
        const spanText = normalizeRef(span.map(plainText).join('\n'))
        if (spanText.includes(normalizeRef(firstLine))) {
          return {
            success: false,
            code: 'ALREADY_APPLIED',
            reason: 'This draft already appears in the section.',
          }
        }
      }

      // Insert at the END of the section (natural reading order), not right under
      // the heading. Empty section → right after the heading.
      let after = span.length ? span[span.length - 1].id : heading.id
      const blocks = markdownToBlocks(ctx.body)
      if (!blocks.length) {
        return { success: false, code: 'NOTION_API_ERROR', reason: 'The draft is empty.' }
      }

      // Chunk sequentially (Notion ~3 req/s + 100-block cap); chain `after` to the
      // last inserted block so order is preserved. Never concurrent.
      let inserted = 0
      for (const part of chunk(blocks, MAX_CHILDREN)) {
        const res = (await this.fetch(`/v1/blocks/${parentId}/children`, {
          method: 'PATCH',
          body: JSON.stringify({ children: part, after }),
        })) as { results?: NBlock[] }
        const results = res.results ?? []
        inserted += results.length
        if (results.length) after = results[results.length - 1].id
      }

      return { success: true, insertedBlocks: inserted }
    } catch (e) {
      if (e instanceof NotionError) return { success: false, code: e.code, reason: e.message }
      return { success: false, code: 'NOTION_API_ERROR', reason: 'Notion API request failed.' }
    }
  }

  /** Resolve the target heading block: exact blockId first, else re-match by text. */
  private async resolveHeading(ctx: ApplyContext): Promise<NBlock> {
    const { anchor } = ctx
    if (anchor.headingBlockId) {
      const b = await this.getBlock(toUuid(anchor.headingBlockId))
      if (b && isHeading(b)) return b
    }
    const pageId = pageIdFromUrl(ctx.url)
    if (!pageId) throw new NotionError('HEADING_NOT_FOUND', 'Could not read the page id from the URL.')
    const children = await this.listChildren(pageId)
    const headings = children.filter(isHeading)
    if (!headings.length) throw new NotionError('HEADING_NOT_FOUND', 'No headings found on the page.')

    const texts = headings.map(plainText)
    // STRICT: this resolves the block we are about to WRITE INTO.
    const idx = matchHeading(anchor.heading, texts, STRICT_MATCH)
    if (idx === null) {
      throw new NotionError('HEADING_NOT_FOUND', 'Heading not found — the document may have changed since the review.')
    }
    return headings[this.disambiguate(texts, idx, anchor.prevHeading, anchor.nextHeading)]
  }

  /** Among headings sharing the matched text, pick the one whose neighbors match the anchor. */
  private disambiguate(texts: string[], idx: number, prev?: string, next?: string): number {
    const norm = (s: string): string => normalizeRef(stripSectionPrefix(s))
    const target = norm(texts[idx])
    const candidates = texts
      .map((t, i) => ({ i, n: norm(t) }))
      .filter((c) => c.n === target)
      .map((c) => c.i)
    if (candidates.length <= 1) return idx
    const pn = prev ? norm(prev) : ''
    const nn = next ? norm(next) : ''
    let best = candidates[0]
    let bestScore = -1
    for (const i of candidates) {
      const before = i > 0 ? norm(texts[i - 1]) : ''
      const afterT = i < texts.length - 1 ? norm(texts[i + 1]) : ''
      const score = (pn && before === pn ? 1 : 0) + (nn && afterT === nn ? 1 : 0)
      if (score > bestScore) {
        bestScore = score
        best = i
      }
    }
    return best
  }

  private parentIdOf(block: NBlock, url: string): string {
    const p = block.parent
    if (p?.type === 'page_id' && p.page_id) return p.page_id
    if (p?.type === 'block_id' && p.block_id) return p.block_id
    const pageId = pageIdFromUrl(url)
    if (pageId) return pageId
    throw new NotionError('NOTION_API_ERROR', 'Could not determine the parent block.')
  }

  /** GET a block; null on 404 (so the caller can fall back to text matching). */
  private async getBlock(id: string): Promise<NBlock | null> {
    try {
      return (await this.fetch(`/v1/blocks/${id}`)) as NBlock
    } catch (e) {
      if (e instanceof NotionError && e.code === 'NOTION_FORBIDDEN') return null
      throw e
    }
  }

  /** List ALL children of a block/page (follows pagination). */
  private async listChildren(id: string): Promise<NBlock[]> {
    const out: NBlock[] = []
    let cursor: string | undefined
    do {
      const qs = cursor ? `?start_cursor=${encodeURIComponent(cursor)}&page_size=100` : '?page_size=100'
      const res = (await this.fetch(`/v1/blocks/${id}/children${qs}`)) as {
        results?: NBlock[]
        has_more?: boolean
        next_cursor?: string | null
      }
      out.push(...(res.results ?? []))
      cursor = res.has_more ? res.next_cursor ?? undefined : undefined
    } while (cursor)
    return out
  }

  private async fetch(path: string, init?: RequestInit): Promise<unknown> {
    let res = await globalThis.fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })

    // Notion allows ~3 req/s and a batch apply issues several per patch, so a 429
    // is expected under load. Retry ONCE, honouring Retry-After — but only for
    // READS. A write (the append PATCH) is never retried: if it actually landed
    // and only the response was lost, retrying would duplicate content in the
    // user's PRD. A failed write surfaces as an error the user can Retry knowingly.
    const isRead = !init?.method || init.method.toUpperCase() === 'GET'
    if (res.status === 429 && isRead) {
      await sleep(retryAfterMs(res))
      res = await globalThis.fetch(`${API}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json',
          ...(init?.headers ?? {}),
        },
      })
    }

    const json = (await res.json().catch(() => ({}))) as { message?: string }
    if (!res.ok) {
      const code =
        res.status === 401
          ? 'NOT_CONNECTED'
          : res.status === 403 || res.status === 404
            ? 'NOTION_FORBIDDEN'
            : 'NOTION_API_ERROR'
      const reason =
        code === 'NOT_CONNECTED'
          ? 'Notion sign-in expired — reconnect in Settings.'
          : code === 'NOTION_FORBIDDEN'
            ? "This page isn't shared with the Pocket PM integration. In Notion: ••• → Connections → add Pocket PM."
            : json.message || `Notion API error (${res.status}).`
      throw new NotionError(code, reason)
    }
    return json
  }
}
