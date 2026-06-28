import { cleanBullet, isBullet } from '@/lib/features/parse'
import type { Sentiment } from '../../types'

export interface ParsedDiscussion {
  title: string
  source: string
  url?: string
  query?: string
  snippet: string
}
export interface ParsedCluster {
  title: string
  sentiment: Sentiment
  discussions: ParsedDiscussion[]
}
export interface ParsedCustomerVoice {
  clusters: ParsedCluster[]
  segments: string[]
  sentimentSummary: string
}

function asSentiment(raw: string): Sentiment {
  const v = raw.trim().toLowerCase()
  if (v.startsWith('neg')) return 'negative'
  if (v.startsWith('pos')) return 'positive'
  return 'neutral'
}

const HEAD_FIELD = /^(TITLE|SOURCE|URL|QUERY):\s*([\s\S]*)$/i

/**
 * Parse one " | "-delimited discussion line. SNIPPET is last and free-text (it
 * may contain "|" or even label-like words), so capture everything after the
 * first SNIPPET: wholesale and only split the head on the fixed leading labels.
 */
function parseDiscussionLine(line: string): ParsedDiscussion | null {
  const body = cleanBullet(line)
  const snip = body.match(/(?:^|\s\|\s)SNIPPET:\s*([\s\S]*)$/i)
  const snippet = snip ? snip[1].trim() : ''
  const head = snip ? body.slice(0, snip.index) : body

  const fields: Record<string, string> = {}
  for (const seg of head.split(/\s+\|\s+(?=(?:TITLE|SOURCE|URL|QUERY):)/i)) {
    const m = seg.match(HEAD_FIELD)
    if (m) fields[m[1].toUpperCase()] = m[2].trim()
  }
  const title = fields.TITLE ?? ''
  if (!title && !snippet) return null
  return {
    title,
    source: (fields.SOURCE || 'web').toLowerCase(),
    url: fields.URL || undefined,
    query: fields.QUERY || undefined,
    snippet,
  }
}

/** Pure parser for the grounded retrieval template. Tolerant of missing sections. */
export function parseCustomerVoice(raw: string): ParsedCustomerVoice {
  const empty: ParsedCustomerVoice = { clusters: [], segments: [], sentimentSummary: '' }
  if (!raw || /no relevant discussions found/i.test(raw)) return empty

  const lines = raw.split('\n')
  const clusters: ParsedCluster[] = []
  const segments: string[] = []
  let summary = ''

  type Mode = 'none' | 'cluster' | 'segments' | 'summary'
  let mode: Mode = 'none'
  let cur: ParsedCluster | null = null

  const flush = () => {
    if (cur && cur.discussions.length) clusters.push(cur)
    cur = null
  }

  for (const line of lines) {
    const painPoint = line.match(/^##\s*PAIN POINT:\s*(.*)$/i)
    if (painPoint) {
      flush()
      mode = 'cluster'
      cur = { title: painPoint[1].trim(), sentiment: 'neutral', discussions: [] }
      continue
    }
    if (/^##\s*USER SEGMENTS/i.test(line)) {
      flush()
      mode = 'segments'
      continue
    }
    if (/^##\s*SENTIMENT SUMMARY/i.test(line)) {
      flush()
      mode = 'summary'
      continue
    }

    if (mode === 'cluster' && cur) {
      const sent = line.match(/^Sentiment:\s*(.*)$/i)
      if (sent) {
        cur.sentiment = asSentiment(sent[1])
        continue
      }
      if (isBullet(line)) {
        const d = parseDiscussionLine(line)
        if (d) cur.discussions.push(d)
      }
      continue
    }
    if (mode === 'segments' && isBullet(line)) {
      const s = cleanBullet(line)
      if (s) segments.push(s)
      continue
    }
    if (mode === 'summary' && line.trim()) {
      summary = summary ? `${summary} ${line.trim()}` : line.trim()
    }
  }
  flush()

  return { clusters, segments, sentimentSummary: summary }
}
