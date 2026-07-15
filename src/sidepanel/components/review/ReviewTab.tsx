import type { ReactNode } from 'react'
import type { ReadinessIssue, ReadinessReview } from '@/lib/features/pmReview'
import type { ProductInsight } from '@/lib/review'
import type { FindingSource } from '@/lib/analytics'
import type { JumpReference } from '@/lib/navigation'
import { Accordion, Chip, JumpText, Thumbs, firstSentence, type ChipTone } from './bits'

// PM Review pane: Decision Confidence → Functional Specs (accordion of chip
// rows) → Non-Functional Specs → Strengths → Product Opportunities.
// Hierarchy: decision dominates; issues are compact rows; detail is nested.
// Each thumbable row carries a FindingSource so its feedback event joins the
// FindingRecord the service worker persisted for the same source.

function Row({
  chip,
  tone,
  source,
  reviewId,
  url,
  children,
}: {
  chip: string
  tone: ChipTone
  source: FindingSource
  reviewId?: string
  url?: string
  children: ReactNode
}) {
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <Chip tone={tone}>{chip}</Chip>
        <Thumbs source={source} reviewId={reviewId} url={url} />
      </div>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

function IssueRow({
  issue,
  chip,
  tone,
  category,
  reviewId,
  url,
  onJump,
}: {
  issue: ReadinessIssue
  chip: string
  tone: ChipTone
  category: string
  reviewId?: string
  url?: string
  onJump?: (ref: JumpReference) => void
}) {
  // Where is hoisted out of the uniform list: it's the navigable reference.
  const details = [
    issue.impact && (['Impact', issue.impact] as const),
    issue.fix && (['Fix', issue.fix] as const),
    issue.example && (['Suggested addition', issue.example] as const),
  ].filter(Boolean) as ReadonlyArray<readonly [string, string]>

  return (
    <Row chip={chip} tone={tone} source={{ agent: 'pm_review', category, title: issue.title }} reviewId={reviewId} url={url}>
      <p className="text-[13px] leading-snug text-slate-800">{issue.title}</p>
      {issue.why && <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{issue.why}</p>}
      {(issue.where || details.length > 0) && (
        <details className="mt-1.5">
          <summary className="cursor-pointer select-none text-[11px] font-medium text-slate-400 hover:text-slate-600 [&::-webkit-details-marker]:hidden">
            Details ▸
          </summary>
          <dl className="mt-1.5 space-y-1.5 border-l-2 border-slate-100 pl-2.5">
            {issue.where && (
              <div>
                <dt className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Where
                </dt>
                <dd className="text-xs leading-relaxed text-slate-600">
                  {onJump ? (
                    <JumpText text={issue.where} onJump={() => onJump({ where: issue.where })} />
                  ) : (
                    issue.where
                  )}
                </dd>
              </div>
            )}
            {details.map(([label, value]) => (
              <div key={label}>
                <dt className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {label}
                </dt>
                <dd className="text-xs leading-relaxed text-slate-600">{value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </Row>
  )
}

export function ReviewTab({
  readiness,
  insights,
  reviewId,
  url,
  onJump,
}: {
  readiness?: ReadinessReview
  insights?: ProductInsight[]
  reviewId?: string
  url?: string
  onJump?: (ref: JumpReference) => void
}) {
  if (!readiness) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-center text-xs text-slate-500">
        The readiness review didn't parse for this run — see the full report below in History, or re-run
        the review.
      </div>
    )
  }
  const r = readiness

  // Functional = issues + non-NFR gaps + questions; NFRs get their own section.
  // category strings match analytics.buildFindingRecords so ids join.
  const missingFunctional = [
    ...r.missingRequirements.map((t) => ({ t, category: 'missing_requirement', chip: 'Missing from PRD' })),
    ...r.missingUserFlows.map((t) => ({ t, category: 'missing_user_flow', chip: 'Missing flow' })),
    ...r.missingEdgeCases.map((t) => ({ t, category: 'missing_edge_case', chip: 'Missing edge case' })),
    ...r.missingAcceptanceCriteria.map((t) => ({ t, category: 'missing_acceptance_criteria', chip: 'Missing AC' })),
  ]
  const questions = [
    ...r.productQuestions.map((t) => ({ t, category: 'product_question' })),
    ...r.engineeringQuestions.map((t) => ({ t, category: 'engineering_question' })),
  ]
  const functionalCount =
    r.critical.length + r.medium.length + r.minor.length + missingFunctional.length + questions.length

  return (
    <div className="space-y-3">
      {/* 1 — Decision Confidence (the verdict dominates) */}
      <section className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[15px] font-bold tracking-tight text-slate-900">Decision Confidence</h3>
          {r.readiness != null && (
            <span className="font-mono text-sm font-semibold text-slate-900">{r.readiness}/100</span>
          )}
        </div>
        {r.readiness != null && (
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
            <div className="h-full rounded-full bg-slate-900" style={{ width: `${r.readiness}%` }} />
          </div>
        )}
        {r.rationale && (
          <p className="mt-2 text-xs leading-relaxed text-slate-600">{firstSentence(r.rationale)}</p>
        )}
        {r.reviewerConfidence && (
          <div className="mt-2">
            <Chip tone="slate">{r.reviewerConfidence} confidence</Chip>
          </div>
        )}
      </section>

      {/* 2 — Functional Specs */}
      {functionalCount > 0 && (
        <Accordion
          title="Functional Specs"
          defaultOpen
          meta={<Chip tone="slate">{functionalCount} Issue{functionalCount === 1 ? '' : 's'}</Chip>}
        >
          {r.critical.map((i, n) => (
            <IssueRow key={`c${n}`} issue={i} chip="Critical" tone="rose" category="critical" reviewId={reviewId} url={url} onJump={onJump} />
          ))}
          {r.medium.map((i, n) => (
            <IssueRow key={`m${n}`} issue={i} chip="Medium" tone="amber" category="medium" reviewId={reviewId} url={url} onJump={onJump} />
          ))}
          {r.minor.map((i, n) => (
            <IssueRow key={`n${n}`} issue={i} chip="Minor" tone="sky" category="minor" reviewId={reviewId} url={url} onJump={onJump} />
          ))}
          {missingFunctional.map(({ t, category, chip }, n) => (
            <Row key={`${category}-${n}`} chip={chip} tone="rose" source={{ agent: 'pm_review', category, title: t }} reviewId={reviewId} url={url}>
              <p className="text-[13px] leading-snug text-slate-800">{t}</p>
            </Row>
          ))}
          {questions.map(({ t, category }, n) => (
            <Row key={`${category}-${n}`} chip="Needs clarification" tone="blue" source={{ agent: 'pm_review', category, title: t }} reviewId={reviewId} url={url}>
              <p className="text-[13px] leading-snug text-slate-800">{t}</p>
            </Row>
          ))}
        </Accordion>
      )}

      {/* 3 — Non-Functional Specs (collapsed; "All Clear" when empty) */}
      <Accordion
        title="Non-Functional Specs"
        meta={
          r.missingNfrs.length === 0 ? (
            <Chip tone="emerald">All Clear</Chip>
          ) : (
            <Chip tone="amber">{r.missingNfrs.length} Issue{r.missingNfrs.length === 1 ? '' : 's'}</Chip>
          )
        }
      >
        {r.missingNfrs.length === 0 ? (
          <p className="px-3 py-2.5 text-xs text-slate-500">
            No missing non-functional requirements were flagged.
          </p>
        ) : (
          r.missingNfrs.map((t, n) => (
            <Row key={n} chip="Missing from PRD" tone="amber" source={{ agent: 'pm_review', category: 'missing_nfr', title: t }} reviewId={reviewId} url={url}>
              <p className="text-[13px] leading-snug text-slate-800">{t}</p>
            </Row>
          ))
        )}
      </Accordion>

      {/* 4 — Implementation Strengths (trust, not just critique) */}
      {r.strengths.length > 0 && (
        <Accordion title="Implementation Strengths" meta={<Chip tone="emerald">{r.strengths.length}</Chip>}>
          {r.strengths.map((t, n) => (
            <div key={n} className="flex items-start gap-2 px-3 py-2.5">
              <span className="mt-px shrink-0 text-emerald-500">✓</span>
              <p className="text-[13px] leading-snug text-slate-700">{t}</p>
            </div>
          ))}
        </Accordion>
      )}

      {/* 5 — Product Opportunities (deep runs; insights from outside the PRD) */}
      {insights && insights.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-3">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-900">
            <span className="text-brand-500">◎</span> Product Opportunities
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Extracted from competitor analysis &amp; customer evidence.
          </p>
          <div className="mt-2 space-y-2">
            {insights.map((ins, n) => (
              <div key={n} className="rounded border border-slate-200 border-l-2 border-l-brand-500 bg-slate-50/50 p-2.5">
                <p className="text-[13px] leading-snug text-slate-800">{ins.text}</p>
                {ins.source && (
                  <p className="mt-1 font-mono text-[10px] text-slate-400">Source: {ins.source}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
