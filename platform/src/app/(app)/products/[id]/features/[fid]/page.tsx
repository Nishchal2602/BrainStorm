import Link from 'next/link'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/session'
import { getFeature } from '@/server/services/features'
import { listPrds } from '@/server/services/prds'
import { FEATURE_STAGE_FLOW, REVIEW_FLOW } from '@/server/stateMachines'
import { StageControl } from '@/components/StageControl'
import { PrdUploadForm } from '@/components/PrdUploadForm'
import { StartReviewButton } from '@/components/StartReviewButton'
import { ReviewRunStatusControl } from '@/components/ReviewRunStatusControl'

export default async function FeaturePage({
  params,
}: {
  params: Promise<{ id: string; fid: string }>
}) {
  const { id, fid } = await params
  const user = await requireUser()
  const feature = await getFeature(user.id, fid)
  const [prds, runs] = await Promise.all([
    listPrds(user.id, fid),
    prisma.reviewRun.findMany({ where: { featureId: fid }, orderBy: { startedAt: 'desc' }, take: 10 }),
  ])
  const latestPrd = prds[0]
  const nextStages = FEATURE_STAGE_FLOW[feature.stage] ?? []

  return (
    <div className="space-y-8">
      <div>
        <Link href={`/products/${id}`} className="text-sm text-slate-500 hover:underline">
          ← Product
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{feature.name}</h1>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{feature.status}</span>
        </div>
        {feature.summary && <p className="mt-1 text-slate-600">{feature.summary}</p>}
        <div className="mt-3">
          <StageControl featureId={fid} currentStage={feature.stage} nextStages={nextStages} />
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          {feature.problemStatement && <Field label="Problem" value={feature.problemStatement} />}
          {feature.proposedSolution && <Field label="Proposed solution" value={feature.proposedSolution} />}
          {feature.successMetric && <Field label="Success metric" value={feature.successMetric} />}
          {feature.targetRelease && <Field label="Target release" value={feature.targetRelease} />}
        </dl>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">PRDs</h2>
        <PrdUploadForm featureId={fid} />
        {prds.length === 0 ? (
          <p className="text-sm text-slate-500">No PRDs uploaded yet.</p>
        ) : (
          <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
            {prds.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span>
                  <span className="font-medium">v{p.version}</span> · {p.title}
                </span>
                <span className="flex items-center gap-3">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{p.status}</span>
                  {p.documentFileId && (
                    <a
                      href={`/api/files/${p.documentFileId}`}
                      target="_blank"
                      className="text-slate-900 underline"
                    >
                      Download
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Review runs</h2>
          <StartReviewButton productId={feature.productId} featureId={fid} prdId={latestPrd?.id} />
        </div>
        {runs.length === 0 ? (
          <p className="text-sm text-slate-500">No review runs yet. Agents run in a later phase — a run starts as Pending.</p>
        ) : (
          <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
            {runs.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="flex items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{r.status}</span>
                  <span className="text-slate-500">{r.trigger}</span>
                </span>
                <ReviewRunStatusControl runId={r.id} nextStatuses={REVIEW_FLOW[r.status] ?? []} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-slate-700">{value}</dd>
    </div>
  )
}
