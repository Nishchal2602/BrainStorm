import type { Competitor, CompetitorPayload } from '@/lib/agents/types'
import { Accordion, Chip, EmptyState, Thumbs, truncate, type ChipTone } from './bits'

// Competitor pane: two always-visible metric cards → grouped accordions
// (Direct / Adjacent / White space) of lightweight list rows.

const LEVEL_TONE: Record<string, ChipTone> = { Low: 'emerald', Medium: 'amber', High: 'rose' }
// For differentiation, high is GOOD — invert the tone mapping.
const DIFF_TONE: Record<string, ChipTone> = { Low: 'rose', Medium: 'amber', High: 'emerald' }

function CompetitorRow({ c }: { c: Competitor }) {
  const line = [c.primaryJob, c.positioning].filter(Boolean).join(' — ')
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-semibold text-slate-900">{c.name}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {c.category && <Chip tone="slate">{truncate(c.category, 24)}</Chip>}
          <span className="font-mono text-[11px] text-slate-400">{Math.round(c.confidence)}%</span>
        </span>
      </div>
      {line && <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{truncate(line, 150)}</p>}
    </div>
  )
}

export function CompetitorTab({
  competitor,
  url,
  onRunDeep,
}: {
  competitor?: CompetitorPayload
  url?: string
  onRunDeep: () => void
}) {
  if (!competitor) {
    return (
      <EmptyState
        icon="📊"
        title="No market analysis yet"
        body="Deep Analysis discovers real competitors, maps the landscape, and scores your differentiation."
        onRunDeep={onRunDeep}
      />
    )
  }

  const landscape = competitor.landscape
  const direct = landscape.competitors.filter((c) => c.relationship === 'direct')
  const adjacent = landscape.competitors.filter((c) => c.relationship !== 'direct')

  // Market crowding: direct-competitor pressure, honoring an explicit signal.
  const crowdedSignal = landscape.signals.some((s) => s.kind === 'crowded')
  const crowding = crowdedSignal || direct.length >= 5 ? 'High' : direct.length >= 3 ? 'Medium' : 'Low'

  return (
    <div className="space-y-3">
      {/* Always-visible metrics */}
      <div className="grid grid-cols-2 gap-2">
        <section className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Differentiation
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="text-lg font-bold tracking-tight text-slate-900">
              {Math.round(competitor.differentiationScore)}/100
            </span>
            <Chip tone={DIFF_TONE[competitor.differentiation] ?? 'slate'}>{competitor.differentiation}</Chip>
          </div>
        </section>
        <section className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Market Crowding
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="text-lg font-bold tracking-tight text-slate-900">{crowding}</span>
            <Chip tone={LEVEL_TONE[crowding] ?? 'slate'}>{direct.length} Direct</Chip>
          </div>
        </section>
      </div>

      {/* Strategy line + feedback */}
      {competitor.recommendation && (
        <section className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs leading-relaxed text-slate-600">{competitor.recommendation}</p>
            <Thumbs itemKey="competitor:recommendation" feature="competitor" url={url} />
          </div>
        </section>
      )}

      {/* Direct competitors */}
      {direct.length > 0 && (
        <Accordion title="Direct Competitors" defaultOpen meta={<Chip tone="rose">{direct.length} items</Chip>}>
          {direct.map((c) => (
            <CompetitorRow key={c.name} c={c} />
          ))}
        </Accordion>
      )}

      {/* Adjacent products + substitutes */}
      {adjacent.length > 0 && (
        <Accordion title="Adjacent Products" meta={<Chip tone="slate">{adjacent.length} items</Chip>}>
          {adjacent.map((c) => (
            <CompetitorRow key={c.name} c={c} />
          ))}
        </Accordion>
      )}

      {/* Strategic white space */}
      {landscape.whiteSpace.length > 0 && (
        <Accordion
          title="Strategic White Space"
          meta={<Chip tone="emerald">{landscape.whiteSpace.length} items</Chip>}
        >
          {landscape.whiteSpace.map((w, i) => (
            <div key={i} className="px-3 py-2.5">
              <p className="text-[13px] leading-snug text-slate-800">{w.opportunity}</p>
              {w.rationale && (
                <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{truncate(w.rationale, 150)}</p>
              )}
            </div>
          ))}
        </Accordion>
      )}

      {landscape.competitors.length === 0 && (
        <p className="rounded-lg border border-slate-200 bg-white px-3 py-4 text-center text-xs text-slate-500">
          No competitors identified from available evidence.
        </p>
      )}
    </div>
  )
}
