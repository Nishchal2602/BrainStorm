import type { ResultDoc } from '@/lib/types'
import type { ReadinessReview } from '@/lib/features/pmReview'
import type { CompetitorPayload, CustomerVoicePayload } from '@/lib/agents/types'
import type { DocMap } from '@/lib/navigation'

// ---------------------------------------------------------------------------
// Structured review view-model attached to a ResultDoc by the service worker.
// The tabbed results UI renders from this; `sections` stay on the ResultDoc
// for copy text, old history entries, and non-review features (flat cards).
// Plain JSON — flows through messaging + chrome.storage history untouched.
// ---------------------------------------------------------------------------

/** A product opportunity surfaced outside the PRD (renamed "Unmapped Insights"). */
export interface ProductInsight {
  text: string
  source?: string
}

export interface ReviewData {
  /** Analytics review id (minted in the SW). Links UI feedback events to the
   * persisted ReviewRecord + FindingRecords. */
  reviewId?: string
  /** Header badge label, e.g. "Build with Changes" / "Validate First". */
  decision?: string
  /** Document map captured at review time — powers jump-to-PRD navigation. */
  docMap?: DocMap
  /** PM Review tab — the Staff-PM implementation-readiness review. */
  readiness?: ReadinessReview
  /** Voice tab lead card (deep runs): the synthesis final verdict. */
  verdict?: string
  /** Voice tab (deep runs only). */
  voice?: CustomerVoicePayload
  /** Competitor tab (deep runs only). */
  competitor?: CompetitorPayload
  /** PM Review tab "Product Opportunities" (deep runs only). */
  insights?: ProductInsight[]
  deep: boolean
}

/** A ResultDoc that may carry the structured review (additive, optional). */
export interface ReviewResultDoc extends ResultDoc {
  review?: ReviewData
}

/** The structured review when present and non-empty; null → legacy flat cards. */
export function getReview(r: ResultDoc): ReviewData | null {
  const review = (r as ReviewResultDoc).review
  if (!review) return null
  return review.readiness || review.voice || review.competitor ? review : null
}
