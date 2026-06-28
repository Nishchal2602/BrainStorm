import { prisma } from '@/lib/db'

const asArray = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).map(String) : [])
type Quote = { quote?: string; url?: string; subreddit?: string }
const asQuotes = (v: unknown): Quote[] => (Array.isArray(v) ? (v as Quote[]) : [])

const VERDICT_COLOR: Record<string, string> = {
  Supported: 'bg-emerald-100 text-emerald-700',
  Mixed: 'bg-amber-100 text-amber-700',
  Weak: 'bg-slate-100 text-slate-600',
  Contradicted: 'bg-rose-100 text-rose-700',
  NoEvidence: 'bg-slate-100 text-slate-500',
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      <div className="mt-2 text-sm text-slate-700">{children}</div>
    </div>
  )
}

function BulletGroup({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null
  return (
    <div className="mt-2">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  )
}

/** Server component: renders the persisted outputs of a completed review run. */
export async function ReviewResults({ runId }: { runId: string }) {
  const [run, pmReview, evidence, snapshots, decision] = await Promise.all([
    prisma.reviewRun.findUnique({ where: { id: runId } }),
    prisma.pMReview.findUnique({ where: { reviewRunId: runId } }),
    prisma.customerEvidence.findMany({ where: { reviewRunId: runId } }),
    prisma.competitorSnapshot.findMany({ where: { reviewRunId: runId }, include: { competitor: true } }),
    prisma.decision.findFirst({ where: { reviewRunId: runId }, orderBy: { createdAt: 'desc' } }),
  ])
  if (!run) return null

  return (
    <div className="space-y-4">
      {/* Recommendation */}
      {(decision || run.recommendation) && (
        <Card title="Recommendation">
          <div className="flex items-center gap-2">
            {run.recommendation && (
              <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-medium text-white">
                {run.recommendation}
              </span>
            )}
            {run.confidence != null && (
              <span className="text-xs text-slate-500">
                confidence {Math.round(Number(run.confidence) * 100)}%
              </span>
            )}
          </div>
          {decision && <p className="mt-2 whitespace-pre-wrap">{decision.decision}</p>}
          {decision?.rationale && <p className="mt-1 text-xs text-slate-500 whitespace-pre-wrap">{decision.rationale}</p>}
        </Card>
      )}

      {/* PM Review */}
      {pmReview && (
        <Card title="PM Review">
          {pmReview.summary && <p>{pmReview.summary}</p>}
          <BulletGroup label="Risks" items={asArray(pmReview.risks)} />
          <BulletGroup label="Missing requirements" items={asArray(pmReview.missingRequirements)} />
          <BulletGroup label="Open questions" items={asArray(pmReview.openQuestions)} />
          <BulletGroup label="Rollout risks" items={asArray(pmReview.rolloutRisks)} />
          <BulletGroup label="Suggested experiments" items={asArray(pmReview.suggestedExperiments)} />
        </Card>
      )}

      {/* Customer Evidence */}
      {evidence.length > 0 && (
        <Card title="Customer Evidence">
          <ul className="space-y-2">
            {evidence.map((e) => {
              const quotes = asQuotes(e.supportingQuotes)
              return (
                <li key={e.id} className="border-b border-slate-100 pb-2 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{e.claim}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${VERDICT_COLOR[e.verdict] ?? 'bg-slate-100'}`}>
                      {e.verdict}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {e.supportingCount} supporting · {e.contradictingCount} contradicting
                  </div>
                  {quotes.slice(0, 2).map((q, i) => (
                    <p key={i} className="mt-1 text-xs italic text-slate-600">
                      “{q.quote}” {q.url && <a href={q.url} target="_blank" className="text-brand-600 underline not-italic">link</a>}
                    </p>
                  ))}
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {/* Competitor Intelligence */}
      {snapshots.length > 0 && (
        <Card title="Competitor Intelligence">
          <ul className="space-y-2">
            {snapshots.map((s) => (
              <li key={s.id} className="border-b border-slate-100 pb-2 last:border-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{s.competitor.name}</span>
                  {s.competitor.category && <span className="text-xs text-slate-500">{s.competitor.category}</span>}
                </div>
                {s.competitor.positioning && <p className="text-xs text-slate-600">{s.competitor.positioning}</p>}
                <BulletGroup label="Strengths" items={asArray(s.strengths)} />
                <BulletGroup label="Weaknesses" items={asArray(s.weaknesses)} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
