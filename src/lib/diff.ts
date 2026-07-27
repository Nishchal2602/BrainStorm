import diff_match_patch from 'diff-match-patch'

// Text diffing for the AI Draft preview — "show the PM exactly what will change
// before we touch their PRD". Deliberately NOT a document differ: it compares one
// section body against the edited draft, as plain text. No markdown, no HTML.
//
// ⚠️ IMPORT BOUNDARY: this module must be imported ONLY from src/sidepanel/**.
// The build emits a single shared chunk loaded by BOTH the side panel and the
// service worker, so importing this from anything the SW can reach would ship
// diff-match-patch (~97KB) into the worker and parse it on every wake.
//
// diff-match-patch notes (its .d.ts uses `export =`): the import must be default,
// the DIFF_* constants are STATIC class members (not module exports), and
// diff_cleanupSemantic mutates the array in place and returns void.

export type DiffPart =
  | { type: 'equal'; text: string }
  | { type: 'added'; text: string }
  | { type: 'removed'; text: string }

/** Merge neighbouring parts of the same type — keeps the rendered output minimal. */
function coalesce(parts: DiffPart[]): DiffPart[] {
  const out: DiffPart[] = []
  for (const part of parts) {
    if (!part.text) continue
    const prev = out[out.length - 1]
    if (prev && prev.type === part.type) out[out.length - 1] = { type: prev.type, text: prev.text + part.text }
    else out.push(part)
  }
  return out
}

/**
 * Character-level diff of two texts (the `replace` path).
 *
 * Whitespace-only insertions/deletions are demoted to `equal` rather than dropped:
 * that satisfies "ignore whitespace-only changes" (nothing gets highlighted) while
 * still emitting the characters, so line breaks and layout survive.
 */
export function generateDiff(original: string, updated: string): DiffPart[] {
  if (original === updated) return original ? [{ type: 'equal', text: original }] : []

  const dmp = new diff_match_patch()
  // Pinned so output is deterministic for a given input pair (the default is
  // already 1.0s, but relying on the default would make that implicit).
  dmp.Diff_Timeout = 1
  const diffs = dmp.diff_main(original, updated)
  dmp.diff_cleanupSemantic(diffs) // mutates in place; returns void

  const parts: DiffPart[] = diffs.map(([op, text]) => {
    // A whitespace-only edit is noise — emit the text as context, unhighlighted.
    if (op !== diff_match_patch.DIFF_EQUAL && text.trim() === '') return { type: 'equal', text }
    switch (op) {
      case diff_match_patch.DIFF_INSERT:
        return { type: 'added', text }
      case diff_match_patch.DIFF_DELETE:
        return { type: 'removed', text }
      default:
        // `Diff` is typed [number, string], never a -1|0|1 union, so this default
        // is required (and covers DIFF_EQUAL).
        return { type: 'equal', text }
    }
  })

  return coalesce(parts)
}

/**
 * Preview for the `append` path — the only action the Notion editor performs today.
 *
 * Append is not a comparison: the outcome is provably `section + draft`, so the
 * parts are constructed directly rather than run through diff-match-patch. Doing
 * an actual diff here would match common substrings between the section and the
 * draft and render a confusing interleaving of "equal" and "added" runs whenever
 * the draft reuses the section's phrasing.
 */
export function appendPreview(original: string | undefined, draft: string): DiffPart[] {
  const parts: DiffPart[] = []
  const context = (original ?? '').trim()
  if (context) parts.push({ type: 'equal', text: context + '\n' })
  if (draft.trim()) parts.push({ type: 'added', text: draft })
  return parts
}

/** Size-only summary for the UI counters, logging, and analytics — never the text. */
export function diffStats(parts: DiffPart[]): {
  added: number
  removed: number
  length: number
  hasChanges: boolean
} {
  let added = 0
  let removed = 0
  for (const part of parts) {
    if (part.type === 'added') added += part.text.length
    else if (part.type === 'removed') removed += part.text.length
  }
  return { added, removed, length: added + removed, hasChanges: added > 0 || removed > 0 }
}
