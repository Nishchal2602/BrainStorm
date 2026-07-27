import type { DocHeading } from '@/lib/navigation'
import { matchHeading, normalizeRef, stripSectionPrefix, STRICT_MATCH } from '@/lib/navigation'
import { sectionLineRange } from '@/lib/sectionView'
import type { ReadinessReview, SuggestedPatch } from '@/lib/features/pmReview'
import { bucketIssues, ISSUE_BUCKETS } from '@/lib/features/pmReview'

// Local patch anchoring — the Phase-3 safety principle in code: the AI never
// decides where an edit lands. After the review parses, we resolve each patch's
// model-emitted targetHeading against the review-time document map (the SAME
// matchHeading ladder jump-to-PRD uses) and derive a durable anchor: normalized
// heading identity, verbatim text, ancestor path, the Notion blockId (session
// fast path), and a SHA-256 of the section text (the apply-time change gate).
// A patch that resolves to no heading is left unanchored → Apply stays disabled.

/**
 * SHA-256 (hex) of the NORMALIZED text — this is a correctness gate, not
 * analytics, so collisions must be impossible. Normalizing first (normalizeRef:
 * lowercase, strip punctuation, collapse whitespace) makes the review-time hash
 * (computed from extracted markdown) comparable to the apply-time hash (computed
 * from live DOM innerText) despite representational noise (`#`, `-`, whitespace).
 * The in-page applier keeps a byte-identical nested copy of this function.
 */
export async function hashSection(text: string): Promise<string> {
  const data = new TextEncoder().encode(normalizeRef(text))
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Cap for the stored `sectionText` (the diff preview's "before"). It rides along
 * on every patch into chrome.storage history (50 entries, no byte cap, and the
 * extension has no `unlimitedStorage`), so it must stay bounded.
 * Keeps the TAIL: appends land at the END of the section, so the closing lines
 * are the context that matters. The marker makes truncation visible.
 */
const SECTION_TEXT_CAP = 4000
const TRUNC_MARKER = '…\n'

export function capSectionText(text: string): string {
  if (text.length <= SECTION_TEXT_CAP) return text
  const tail = text.slice(text.length - (SECTION_TEXT_CAP - TRUNC_MARKER.length))
  // Snap to a line boundary so the preview never starts mid-sentence.
  const nl = tail.indexOf('\n')
  return TRUNC_MARKER + (nl > -1 && nl < 200 ? tail.slice(nl + 1) : tail)
}

/**
 * Best-effort slice of one section's body text from the extracted page content:
 * from the resolved heading's line to the next heading's line (document order).
 * Notion headings appear as plain lines in the extracted content, real-heading
 * pages as `# …` lines — normalizeRef collapses both. Returns undefined when the
 * heading line can't be located (hash gate then skipped; heading match +
 * duplicate check still protect the apply).
 */
export function sectionTextFor(
  content: string,
  headings: DocHeading[],
  index: number,
): string | undefined {
  // Slicing lives in sectionView.ts — ONE implementation, so the text used for the
  // hash/preview and the structure shown to the model can never disagree.
  const range = sectionLineRange(content, headings, index)
  if (!range) return undefined
  return content.split('\n').slice(range.start + 1, range.end).join('\n').trim()
}

/**
 * Anchor ONE patch against a document map by its model-emitted targetHeading.
 * Sets `patch.anchor` on a hit; leaves it unset on a miss (Apply stays disabled).
 * Shared by the bulk review pass and the per-issue Retry path.
 */
export async function anchorPatch(
  patch: SuggestedPatch,
  content: string,
  headings: DocHeading[],
): Promise<void> {
  if (!headings.length) return
  // STRICT: a loose match here anchors the patch to the wrong section, and Apply
  // would then silently write there. No anchor is better than a wrong one.
  const idx = matchHeading(patch.targetHeading, headings.map((h) => h.text), STRICT_MATCH)
  if (idx === null) return
  const h = headings[idx]
  const sectionText = sectionTextFor(content, headings, idx)
  patch.anchor = {
    heading: normalizeRef(stripSectionPrefix(h.text)),
    headingText: h.text,
    path: h.path,
    headingBlockId: h.blockId,
    // Adjacent headings in doc order — disambiguate duplicate headings at apply time.
    prevHeading: headings[idx - 1]?.text,
    nextHeading: headings[idx + 1]?.text,
    // Hash the FULL text (it's a change gate); store a capped copy for display.
    sectionHash: sectionText !== undefined ? await hashSection(sectionText) : undefined,
    sectionText: sectionText !== undefined ? capSectionText(sectionText) : undefined,
  }
}

/**
 * Anchor every suggestedPatch in a parsed review against the review-time
 * document map. Mutates the review in place (patches gain `.anchor`). Idempotent
 * and safe when no headings were captured (every patch stays unanchored).
 */
export async function anchorPatches(
  review: ReadinessReview,
  ctx: { content: string; headings?: DocHeading[] },
): Promise<void> {
  const headings = ctx.headings ?? []
  if (!headings.length) return

  // Derived from ISSUE_BUCKETS: a bucket missed here would never get an anchor,
  // which silently disables Apply for every patch in it.
  const patches: SuggestedPatch[] = ISSUE_BUCKETS.flatMap((b) => bucketIssues(review, b))
    .map((i) => i.suggestedPatch)
    .filter((p): p is SuggestedPatch => Boolean(p))

  for (const patch of patches) await anchorPatch(patch, ctx.content, headings)
}
