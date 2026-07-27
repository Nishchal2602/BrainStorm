import { useMemo } from 'react'
import { appendPreview, diffStats, generateDiff, type DiffPart } from '@/lib/diff'
import { Chip } from './bits'

// Transparency before mutation: shows exactly what the AI Draft will add to the
// PRD section, recomputed live as the user edits. Plain text only — no markdown
// rendering, no syntax highlighting.
//
// Added/removed are distinguished by WEIGHT and STRIKETHROUGH as well as colour,
// so the diff still reads correctly without colour vision.

/** Height-clamped like the draft textarea (rowsFor caps at 14 rows ≈ 220px). */
const BOX_CLS =
  'max-h-[220px] overflow-y-auto whitespace-pre-wrap break-words rounded border border-slate-200 bg-slate-50/50 p-2.5 font-mono text-xs leading-relaxed text-slate-600'

function Part({ part }: { part: DiffPart }) {
  if (part.type === 'added') {
    return <ins className="bg-emerald-50 font-semibold text-emerald-700 no-underline">{part.text}</ins>
  }
  if (part.type === 'removed') {
    return <del className="bg-rose-50 text-rose-600 line-through">{part.text}</del>
  }
  return <span>{part.text}</span>
}

export function DiffPreview({
  original,
  updated,
  action,
}: {
  /** Section body captured at review time; absent → the addition shows without context. */
  original?: string
  /** The current (possibly edited) draft text. */
  updated: string
  action: 'append' | 'replace'
}) {
  // Cheap enough to run on every keystroke: append does no diffing at all, and
  // replace diffs one section, not the document.
  const parts = useMemo(
    () => (action === 'append' ? appendPreview(original, updated) : generateDiff(original ?? '', updated)),
    [original, updated, action],
  )
  const stats = useMemo(() => diffStats(parts), [parts])
  const hasContext = parts.some((p) => p.type === 'equal')

  // Collapsed by default — the counts stay visible in the summary, so the size of
  // the change is legible without opening it.
  return (
    <details>
      <summary className="flex cursor-pointer select-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
        <span className="text-[11px] font-medium text-slate-400 hover:text-slate-600">
          Preview changes ▸
        </span>
        <span className="flex items-center gap-1">
          {stats.added > 0 && <Chip tone="emerald">+{stats.added}</Chip>}
          {stats.removed > 0 && <Chip tone="rose">−{stats.removed}</Chip>}
        </span>
      </summary>
      <div className={`mt-1.5 ${BOX_CLS}`} aria-label="Preview of changes to the document section">
        {stats.hasChanges ? (
          parts.map((part, i) => <Part key={i} part={part} />)
        ) : (
          <span className="text-slate-400">No changes.</span>
        )}
      </div>
      {hasContext && stats.hasChanges && (
        <p className="mt-1 text-[10px] text-slate-400">
          Unhighlighted text is the existing section, as captured during this review.
        </p>
      )}
    </details>
  )
}
