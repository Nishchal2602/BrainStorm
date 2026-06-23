import { withTimeout } from '../../runtime'
import type { DiscussionDoc, RedditComment } from './types'

const SEARCH_QUERIES_CAP = 8
const PRIORITY_SUBS = ['productmanagement', 'startups', 'SaaS', 'UXResearch']
const PRIORITY_SEARCH_CAP = 3
const POSTS_CAP = 25
const COMMENT_POSTS_CAP = 8
const TOP_COMMENTS = 4
const REQ_TIMEOUT_MS = 6000
const CONCURRENCY = 4
const BODY_CAP = 600
const COMMENT_CAP = 400
const MIN_COMMENT_LEN = 40

interface RawPost {
  id?: string
  title?: string
  subreddit?: string
  score?: number
  num_comments?: number
  permalink?: string
  selftext?: string
  url?: string
  over_18?: boolean
}

/** Fetch JSON, tolerating any failure (returns null). The service worker can't set
 * a User-Agent, so Reddit may rate-limit/403 — every caller treats null as "no data". */
async function getJson(url: string): Promise<unknown | null> {
  try {
    const res = await withTimeout(
      fetch(url, { headers: { accept: 'application/json' } }),
      REQ_TIMEOUT_MS,
      url,
    )
    if (!res.ok) return null
    if (!(res.headers.get('content-type') ?? '').includes('json')) return null
    return await res.json()
  } catch {
    return null
  }
}

/** Bounded-concurrency map (no external dep). */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

function listingPosts(json: unknown): RawPost[] {
  const children = (json as { data?: { children?: Array<{ data?: RawPost }> } })?.data?.children
  if (!Array.isArray(children)) return []
  return children.map((c) => c.data).filter((d): d is RawPost => !!d && typeof d.id === 'string')
}

function toDoc(p: RawPost): DiscussionDoc {
  const permalink = p.permalink ?? ''
  return {
    id: p.id as string,
    title: (p.title ?? '').trim(),
    subreddit: p.subreddit ?? '',
    score: typeof p.score === 'number' ? p.score : 0,
    numComments: typeof p.num_comments === 'number' ? p.num_comments : 0,
    url: permalink ? `https://www.reddit.com${permalink}` : (p.url ?? ''),
    body: (p.selftext ?? '').slice(0, BODY_CAP),
    comments: [],
  }
}

async function fetchTopComments(doc: DiscussionDoc): Promise<RedditComment[]> {
  // Only Reddit permalinks have a .json comments endpoint; link posts point off-site.
  if (!doc.url.startsWith('https://www.reddit.com')) return []
  const path = doc.url.replace(/^https:\/\/www\.reddit\.com/, '')
  const json = await getJson(`https://www.reddit.com${path}.json?limit=15&sort=top&raw_json=1`)
  if (!Array.isArray(json) || json.length < 2) return []
  const children = (json[1] as { data?: { children?: Array<{ data?: { body?: string; score?: number } }> } })
    ?.data?.children
  if (!Array.isArray(children)) return []
  const comments: RedditComment[] = []
  for (const c of children) {
    const body = (c.data?.body ?? '').trim()
    if (!body || body === '[deleted]' || body === '[removed]' || body.length < MIN_COMMENT_LEN) continue
    comments.push({ body: body.slice(0, COMMENT_CAP), score: c.data?.score ?? 0 })
    if (comments.length >= TOP_COMMENTS) break
  }
  return comments
}

/**
 * Reddit-first retrieval: global + priority-subreddit searches, dedup, top posts
 * by score, then top comments for the strongest posts. Returns whatever it can
 * get; an empty array means Reddit was unavailable (caller falls back).
 */
export async function searchReddit(queries: string[]): Promise<DiscussionDoc[]> {
  const qs = queries.slice(0, SEARCH_QUERIES_CAP)
  if (!qs.length) return []

  const urls = qs.map(
    (q) =>
      `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&limit=10&sort=relevance&type=link&raw_json=1`,
  )
  // A few priority-subreddit searches with the strongest query, to bias toward PM communities.
  for (const sub of PRIORITY_SUBS.slice(0, PRIORITY_SEARCH_CAP)) {
    urls.push(
      `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(qs[0])}&restrict_sr=1&limit=8&sort=top&raw_json=1`,
    )
  }

  const listings = await mapPool(urls, CONCURRENCY, getJson)
  const byId = new Map<string, DiscussionDoc>()
  for (const listing of listings) {
    for (const p of listingPosts(listing)) {
      if (p.over_18 || byId.has(p.id as string)) continue
      byId.set(p.id as string, toDoc(p))
    }
  }

  const docs = [...byId.values()].sort((a, b) => b.score - a.score).slice(0, POSTS_CAP)
  const top = docs.slice(0, COMMENT_POSTS_CAP)
  const commentLists = await mapPool(top, CONCURRENCY, fetchTopComments)
  top.forEach((doc, i) => {
    doc.comments = commentLists[i] ?? []
  })
  return docs
}
