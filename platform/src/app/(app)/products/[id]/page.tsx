import Link from 'next/link'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/session'
import { getProduct } from '@/server/services/products'
import { listFeatures } from '@/server/services/features'
import { listDecisions } from '@/server/services/decisions'
import { CreateFeatureForm } from '@/components/CreateFeatureForm'
import { DecisionPanel } from '@/components/DecisionPanel'

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()
  const product = await getProduct(user.id, id)
  const [features, decisions, timeline] = await Promise.all([
    listFeatures(user.id, id),
    listDecisions(user.id, id),
    prisma.timelineEvent.findMany({ where: { productId: id }, orderBy: { createdAt: 'desc' }, take: 30 }),
  ])

  return (
    <div className="space-y-8">
      <div>
        <Link href="/products" className="text-sm text-slate-500 hover:underline">
          ← Products
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{product.name}</h1>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{product.phase}</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{product.status}</span>
        </div>
        {product.summary && <p className="mt-1 text-slate-600">{product.summary}</p>}
        <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
          {product.vision && <Field label="Vision" value={product.vision} />}
          {product.problemStatement && <Field label="Problem" value={product.problemStatement} />}
          {product.targetPersona && <Field label="Target persona" value={product.targetPersona} />}
        </dl>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Features</h2>
          <CreateFeatureForm productId={id} />
        </div>
        {features.length === 0 ? (
          <p className="text-sm text-slate-500">No features yet.</p>
        ) : (
          <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
            {features.map((f) => (
              <li key={f.id}>
                <Link
                  href={`/products/${id}/features/${f.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-slate-50"
                >
                  <div>
                    <div className="font-medium">{f.name}</div>
                    {f.summary && <div className="text-sm text-slate-500">{f.summary}</div>}
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{f.stage}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{f.priority}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <DecisionPanel
          productId={id}
          decisions={decisions.map((d) => ({
            id: d.id,
            title: d.title,
            decision: d.decision,
            rationale: d.rationale,
            status: d.status,
            createdAt: d.createdAt.toISOString(),
          }))}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">Timeline</h2>
        {timeline.length === 0 ? (
          <p className="text-sm text-slate-500">No activity yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {timeline.map((e) => (
              <li key={e.id} className="flex items-baseline gap-3 text-sm">
                <span className="font-mono text-xs text-slate-400">
                  {new Date(e.createdAt).toLocaleString()}
                </span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{e.entityType}</span>
                <span className="text-slate-700">{e.eventType}</span>
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
