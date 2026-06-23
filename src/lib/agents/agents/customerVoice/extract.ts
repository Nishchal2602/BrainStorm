import type { TokenUsage } from '@/lib/types'
import type { LlmPort } from '../../llm'
import type { DiscussionDoc } from './types'

/** One quote the model attributes to a specific discussion (by index). */
export interface ExtractedQuote {
  docIndex: number
  quote: string
}
export interface ExtractedTheme {
  name: string
  /** 0–3 emotional intensity of the complaints in this theme. */
  emotionScore: number
  quotes: ExtractedQuote[]
}
export interface ExtractionResult {
  themes: ExtractedTheme[]
  userSegments: string[]
  sentimentSummary: string
}

// Gemini responseSchema is an OpenAPI subset — no `additionalProperties`.
const SCHEMA = {
  type: 'object',
  properties: {
    themes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          emotionScore: { type: 'number' },
          quotes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                docIndex: { type: 'number' },
                quote: { type: 'string' },
              },
              required: ['docIndex', 'quote'],
            },
          },
        },
        required: ['name', 'emotionScore', 'quotes'],
      },
    },
    userSegments: { type: 'array', items: { type: 'string' } },
    sentimentSummary: { type: 'string' },
  },
  required: ['themes', 'userSegments', 'sentimentSummary'],
} as const

const SYSTEM = `You are a user researcher analyzing real discussions to find evidence of ONE specific product problem (stated under "PROBLEM UNDER REVIEW"). You are given numbered discussions (Reddit posts + top comments). Cluster the genuine complaints into a small set of NON-DUPLICATE pain themes.

RELEVANCE IS THE PRIORITY — be strict:
- Every theme must be a FACET OF THE STATED PROBLEM, not merely the same product/industry/domain. Being in the same field is NOT relevance.
- Every quote must DIRECTLY express the stated problem (or a clear sub-problem of it).
- EXCLUDE any discussion that is off-topic or only tangentially related — drop it entirely. Do not stretch or manufacture thematic relevance to a quote that is really about something else.
- If, after filtering, there is no genuine on-topic evidence, return empty themes. Empty is correct — do not pad with loosely-related content.

Other rules:
- Use ONLY quotes copied VERBATIM from the provided discussions — never paraphrase or invent. Copy the exact wording.
- Cite each quote's source with its docIndex (the [#] of the discussion it came from).
- Ignore jokes, generic advice, and praise.
- Merge similar complaints into one theme; no duplicate/near-duplicate themes. Name each theme as a short complaint (e.g. "Verification takes too long").
- emotionScore (0–3): how emotionally intense/frustrated the complaints in the theme are (0 = mild, 3 = very frustrated).
- userSegments: who experiences this (e.g. "first-time founders", "small businesses") — only if evident.
- sentimentSummary: 1–2 sentences on overall sentiment.`

function renderDocs(docs: DiscussionDoc[]): string {
  return docs
    .map((d, i) => {
      const comments = d.comments.map((c) => `  > ${c.body}`).join('\n')
      return [
        `[${i}] r/${d.subreddit} (score ${d.score}) — ${d.title}`,
        d.body ? d.body : '',
        comments,
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n\n')
}

/** Step 3–4: one structured LLM call that extracts evidence-bearing quotes and
 * clusters them into themes. Returns raw model output (verified later in score.ts). */
export async function extractThemes(
  llm: LlmPort,
  docs: DiscussionDoc[],
  problem: string,
  meta?: { clientId?: string },
): Promise<{ result: ExtractionResult; usage?: TokenUsage }> {
  const user = `PROBLEM UNDER REVIEW: ${problem}\n\nDISCUSSIONS:\n${renderDocs(docs)}`
  const { data, usage } = await llm.generateStructured<ExtractionResult>({
    system: SYSTEM,
    user,
    schema: SCHEMA as object,
    maxTokens: 3000,
    label: 'customer_voice_extract',
    meta,
  })
  // Model may return JSON null/garbage that parses but isn't an object — degrade
  // to empty rather than throwing (which would mark the whole agent errored).
  const d = (data && typeof data === 'object' ? data : {}) as Partial<ExtractionResult>
  return {
    result: {
      themes: Array.isArray(d.themes) ? d.themes : [],
      userSegments: Array.isArray(d.userSegments) ? d.userSegments : [],
      sentimentSummary: typeof d.sentimentSummary === 'string' ? d.sentimentSummary : '',
    },
    usage,
  }
}
