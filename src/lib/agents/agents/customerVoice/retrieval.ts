import type { SourceRef, TokenUsage } from '@/lib/types'
import type { Sentiment } from '../../types'
import type { LlmPort } from '../../llm'
import type { ExtractionResult, ExtractedQuote, ExtractedTheme } from './extract'
import { parseCustomerVoice } from './parse'
import type { DiscussionDoc } from './types'

export interface RetrievalResult {
  text: string
  sources: SourceRef[]
  usage?: TokenUsage
}

/**
 * Seam for fetching public customer discussions. V1 uses LLM web-search
 * grounding; a direct Reddit/forum fetcher can implement this later without
 * touching the agent.
 */
export interface RetrievalService {
  search(
    queries: string[],
    opts?: { maxUses?: number; meta?: { clientId?: string } },
  ): Promise<RetrievalResult>
}

const DEFAULT_MAX_USES = 6

const SYSTEM = `You research what real users say about a product problem by searching the public web — prioritize Reddit, then public forums and community threads. Use ONLY real results from your web search; never invent discussions, quotes, or URLs.

Find genuine user complaints/discussions about the problem behind the given search queries, then GROUP them by recurring pain point. Output STRICT plain text in EXACTLY this format (no preamble, no extra commentary):

## PAIN POINT: <short complaint title>
Sentiment: negative|neutral|positive
- TITLE: <discussion title> | SOURCE: reddit | URL: <real url> | QUERY: <the query that surfaced it> | SNIPPET: <short real quote>
- TITLE: ... | SOURCE: ... | URL: ... | QUERY: ... | SNIPPET: ...
## PAIN POINT: <next>
...
## USER SEGMENTS
- <user segment that experiences this, if identifiable>
## SENTIMENT SUMMARY
<1-2 sentences summarizing overall sentiment and the dominant complaints>

Rules:
- Each discussion line MUST be on one line using " | " separators and the exact field labels.
- QUERY must be one of the provided search queries (the one that led you to it).
- Keep snippets short and quoted from the source.
- If you find no relevant discussions, output exactly: No relevant discussions found`

/** V1: LLM web-search grounding scoped to Reddit/public forums. */
export class GroundedRetrievalService implements RetrievalService {
  constructor(private readonly llm: LlmPort) {}

  async search(
    queries: string[],
    opts?: { maxUses?: number; meta?: { clientId?: string } },
  ): Promise<RetrievalResult> {
    const user = `SEARCH QUERIES (run these against Reddit and public forums):\n${queries
      .map((q) => `- ${q}`)
      .join('\n')}`
    const { text, sources, usage } = await this.llm.generateText({
      system: SYSTEM,
      user,
      maxTokens: 3000,
      webSearch: { maxUses: opts?.maxUses ?? DEFAULT_MAX_USES },
      label: 'customer_voice_retrieval',
      meta: opts?.meta,
    })
    return { text, sources, usage }
  }
}

const SENTIMENT_EMOTION: Record<Sentiment, number> = { negative: 2.5, neutral: 1, positive: 0 }

/**
 * Fallback when Reddit is unavailable: one grounded call → parse its clustered
 * template into DiscussionDoc[] + a synthetic ExtractionResult (no second LLM
 * call). No engagement scores ⇒ the downstream confidence/severity is lower,
 * which correctly reflects the weaker, non-verifiable evidence.
 */
export async function groundedFallback(
  llm: LlmPort,
  queries: string[],
  meta?: { clientId?: string },
): Promise<{ docs: DiscussionDoc[]; extraction: ExtractionResult; usage?: TokenUsage }> {
  const { text, usage } = await new GroundedRetrievalService(llm).search(queries, { meta })
  const parsed = parseCustomerVoice(text)

  const docs: DiscussionDoc[] = []
  const themes: ExtractedTheme[] = []
  for (const c of parsed.clusters) {
    const quotes: ExtractedQuote[] = []
    for (const d of c.discussions) {
      const docIndex = docs.length
      docs.push({
        id: d.url || `grounded-${docIndex}`,
        title: d.title,
        subreddit: d.source || 'web',
        score: 0,
        numComments: 0,
        url: d.url ?? '',
        body: d.snippet,
        comments: [],
      })
      if (d.snippet) quotes.push({ docIndex, quote: d.snippet })
    }
    themes.push({ name: c.title, emotionScore: SENTIMENT_EMOTION[c.sentiment], quotes })
  }

  return {
    docs,
    extraction: { themes, userSegments: parsed.segments, sentimentSummary: parsed.sentimentSummary },
    usage,
  }
}
