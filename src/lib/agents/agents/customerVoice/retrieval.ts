import type { SourceRef, TokenUsage } from '@/lib/types'
import type { LlmPort } from '../../llm'

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
  search(queries: string[], opts?: { maxUses?: number }): Promise<RetrievalResult>
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

  async search(queries: string[], opts?: { maxUses?: number }): Promise<RetrievalResult> {
    const user = `SEARCH QUERIES (run these against Reddit and public forums):\n${queries
      .map((q) => `- ${q}`)
      .join('\n')}`
    const { text, sources, usage } = await this.llm.generateText({
      system: SYSTEM,
      user,
      maxTokens: 3000,
      webSearch: { maxUses: opts?.maxUses ?? DEFAULT_MAX_USES },
      label: 'customer_voice_retrieval',
    })
    return { text, sources, usage }
  }
}
