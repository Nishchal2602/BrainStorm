'use client'
import { useState } from 'react'

/**
 * Presentation-only executive dashboard for a completed review run.
 * All data is fetched + derived server-side in ReviewResults.tsx and passed in
 * as plain props — this component holds no business logic and makes no requests.
 * The only state is local expand/collapse for the hero reasoning.
 */

type Tone = 'emerald' | 'amber' | 'rose' | 'slate' | 'violet'

const TONE: Record<Tone, { badge: string; text: string; dot: string }> = {
  emerald: { badge: 'bg-emerald-100 text-emerald-700', text: 'text-emerald-600', dot: 'bg-emerald-500' },
  amber: { badge: 'bg-amber-100 text-amber-700', text: 'text-amber-600', dot: 'bg-amber-500' },
  rose: { badge: 'bg-rose-100 text-rose-700', text: 'text-rose-600', dot: 'bg-rose-500' },
  slate: { badge: 'bg-slate-100 text-slate-600', text: 'text-slate-600', dot: 'bg-slate-400' },
  violet: { badge: 'bg-violet-100 text-violet-700', text: 'text-violet-600', dot: 'bg-violet-500' },
}

export interface Quote {
  quote?: string
  url?: string
  subreddit?: string
}
export interface EvidenceItem {
  id: string
  claim: string
  verdict: string
  verdictTone: Tone
  verdictLabel: string
  supportingCount: number
  contradictingCount: number
  quotes: Quote[]
  sources: { label: string; url?: string }[]
}
export interface CompetitorItem {
  id: string
  name: string
  category?: string | null
  positioning?: string | null
  strengths: string[]
  weaknesses: string[]
  capabilities: string[]
  threatLevel?: string | null
  differentiationScore?: number | null
}
export interface ExecStep {
  key: string
  label: string
  state: 'pending' | 'running' | 'completed' | 'failed'
}
export interface Kpi {
  label: string
  value: string
  sub: string
  tone: Tone
}
export interface ReviewData {
  recommendation: { label: string; tone: Tone } | null
  confidencePct: number | null
  executiveSummary: string | null
  topOpportunity: string | null
  biggestRisk: string | null
  rationale: string | null
  kpis: Kpi[]
  execution: {
    isLemma: boolean
    lemmaRunId?: string | null
    status: string
    startedAt: string | null
    completedAt: string | null
    durationLabel: string | null
    steps: ExecStep[]
  }
  pmReview: { summary: string | null; groups: { label: string; items: string[] }[] } | null
  evidence: EvidenceItem[]
  competitors: CompetitorItem[]
}

const STEP_ICON: Record<ExecStep['state'], string> = {
  pending: '○',
  running: '◐',
  completed: '✓',
  failed: '✕',
}
const STEP_TONE: Record<ExecStep['state'], string> = {
  pending: 'text-slate-300',
  running: 'text-violet-500',
  completed: 'text-emerald-500',
  failed: 'text-rose-500',
}

export function ReviewDashboard({ data }: { data: ReviewData }) {
  const [showWhy, setShowWhy] = useState(false)

  return (
    <div className="space-y-6">
      {/* 1 — Executive Recommendation Hero */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          {data.recommendation && (
            <span className={`rounded-full px-3 py-1 text-sm font-semibold ${TONE[data.recommendation.tone].badge}`}>
              {data.recommendation.label}
            </span>
          )}
          {data.confidencePct != null && (
            <span className="text-sm font-medium text-slate-500">{data.confidencePct}% confidence</span>
          )}
        </div>

        <h2 className="mt-4 text-lg font-semibold text-slate-900">Executive Recommendation</h2>
        {data.executiveSummary && (
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600">{data.executiveSummary}</p>
        )}

        <dl className="mt-4 space-y-2">
          {data.topOpportunity && (
            <HeroPoint tone="emerald" icon="✓" label="Top opportunity" value={data.topOpportunity} />
          )}
          {data.biggestRisk && (
            <HeroPoint tone="amber" icon="!" label="Biggest risk" value={data.biggestRisk} />
          )}
        </dl>

        <div className="mt-5 flex flex-wrap gap-2">
          <a
            href="#full-report"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
          >
            View Full Report
          </a>
          {data.rationale && (
            <button
              type="button"
              onClick={() => setShowWhy((v) => !v)}
              aria-expanded={showWhy}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              {showWhy ? 'Hide reasoning' : 'Why?'}
            </button>
          )}
        </div>
        {showWhy && data.rationale && (
          <div className="mt-3 rounded-lg bg-slate-50 p-4 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
            {data.rationale}
          </div>
        )}
      </section>

      {/* 2 — KPI cards */}
      {data.kpis.length > 0 && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {data.kpis.map((k) => (
            <div key={k.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{k.label}</div>
              <div className={`mt-1 text-xl font-semibold ${TONE[k.tone].text}`}>{k.value}</div>
              <div className="mt-0.5 text-xs text-slate-500">{k.sub}</div>
            </div>
          ))}
        </section>
      )}

      {/* 3 — Review Execution timeline */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="text-sm font-semibold text-slate-800">Review Execution</h3>
          {data.execution.isLemma && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
              Executed with Lemma
            </span>
          )}
          {data.execution.durationLabel && (
            <span className="text-xs text-slate-400">Completed in {data.execution.durationLabel}</span>
          )}
        </div>

        <ol className="mt-4 space-y-2.5">
          {data.execution.steps.map((s) => (
            <li key={s.key} className="flex items-center gap-3 text-sm">
              <span className={`text-base leading-none ${STEP_TONE[s.state]}`}>{STEP_ICON[s.state]}</span>
              <span className={s.state === 'running' ? 'font-medium text-violet-900' : 'text-slate-700'}>
                {s.label}
              </span>
            </li>
          ))}
        </ol>

        {data.execution.isLemma && data.execution.lemmaRunId && (
          <div className="mt-4 border-t border-slate-100 pt-3 text-xs">
            <span className="font-medium uppercase tracking-wide text-slate-400">Workflow ID</span>
            <div className="mt-0.5 truncate font-mono text-slate-600" title={data.execution.lemmaRunId}>
              {data.execution.lemmaRunId}
            </div>
          </div>
        )}
      </section>

      {/* Detailed report — anchor target for "View Full Report" */}
      <div id="full-report" className="scroll-mt-20 space-y-6">
        {/* 4 — PM Review (accordions) */}
        {data.pmReview && (data.pmReview.summary || data.pmReview.groups.length > 0) && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">PM Review</h3>
            {data.pmReview.summary && (
              <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-700 shadow-sm">
                {data.pmReview.summary}
              </p>
            )}
            <div className="space-y-2">
              {data.pmReview.groups.map((g, i) => (
                <details
                  key={g.label}
                  open={i === 0}
                  className="group rounded-xl border border-slate-200 bg-white shadow-sm"
                >
                  <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-slate-800 [&::-webkit-details-marker]:hidden">
                    <span className="flex items-center gap-2">
                      {g.label}
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-500">
                        {g.items.length}
                      </span>
                    </span>
                    <span className="text-slate-400 transition group-open:rotate-180">⌄</span>
                  </summary>
                  <ul className="list-disc space-y-1 px-4 pb-4 pl-9 text-sm text-slate-700">
                    {g.items.map((t, j) => (
                      <li key={j}>{t}</li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </section>
        )}

        {/* 5 — Customer Evidence cards */}
        {data.evidence.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Customer Evidence</h3>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {data.evidence.map((e) => (
                <div key={e.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <h4 className="text-sm font-semibold text-slate-900">{e.claim}</h4>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${TONE[e.verdictTone].badge}`}>
                      {e.verdictLabel}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {e.supportingCount} supporting · {e.contradictingCount} contradicting
                  </div>
                  {e.quotes.slice(0, 2).map((q, i) => (
                    <blockquote key={i} className="mt-2 border-l-2 border-slate-200 pl-3 text-xs italic text-slate-600">
                      “{q.quote}”
                      {q.url && (
                        <a href={q.url} target="_blank" rel="noreferrer" className="ml-1 text-slate-900 underline not-italic">
                          source
                        </a>
                      )}
                    </blockquote>
                  ))}
                  {e.sources.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      {e.sources.map((s, i) =>
                        s.url ? (
                          <a key={i} href={s.url} target="_blank" rel="noreferrer" className="text-slate-500 underline">
                            {s.label}
                          </a>
                        ) : (
                          <span key={i} className="text-slate-400">
                            {s.label}
                          </span>
                        ),
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 6 — Competitor Intelligence cards */}
        {data.competitors.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Competitor Intelligence</h3>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {data.competitors.map((c) => (
                <div key={c.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900">{c.name}</h4>
                      {c.category && <div className="text-xs text-slate-500">{c.category}</div>}
                    </div>
                    {c.threatLevel && (
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                          TONE[c.threatLevel === 'High' ? 'rose' : c.threatLevel === 'Medium' ? 'amber' : 'slate'].badge
                        }`}
                      >
                        {c.threatLevel} threat
                      </span>
                    )}
                  </div>
                  {c.positioning && <p className="mt-2 text-xs text-slate-600">{c.positioning}</p>}
                  <CompetitorList label="Strengths" items={c.strengths} marker="●" markerClass="text-emerald-500" />
                  <CompetitorList label="Weaknesses" items={c.weaknesses} marker="○" markerClass="text-slate-400" />
                  <CompetitorList label="Capabilities" items={c.capabilities} marker="•" markerClass="text-slate-400" />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function HeroPoint({ tone, icon, label, value }: { tone: Tone; icon: string; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${TONE[tone].dot}`}>
        {icon}
      </span>
      <p className="text-sm text-slate-700">
        <span className="font-semibold text-slate-900">{label}:</span> {value}
      </p>
    </div>
  )
}

function CompetitorList({
  label,
  items,
  marker,
  markerClass,
}: {
  label: string
  items: string[]
  marker: string
  markerClass: string
}) {
  if (!items.length) return null
  return (
    <div className="mt-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <ul className="mt-1 space-y-0.5 text-xs text-slate-700">
        {items.map((t, i) => (
          <li key={i} className="flex items-start gap-1.5">
            <span className={`mt-px ${markerClass}`}>{marker}</span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
