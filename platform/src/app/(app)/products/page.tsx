import Link from 'next/link'
import { requireUser } from '@/lib/session'
import { listProducts } from '@/server/services/products'
import { CreateProductForm } from '@/components/CreateProductForm'

export default async function ProductsPage() {
  const user = await requireUser()
  const products = await listProducts(user.id)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Products</h1>
        <CreateProductForm />
      </div>

      {products.length === 0 ? (
        <p className="text-sm text-slate-500">No products yet. Create your first one.</p>
      ) : (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
          {products.map((p) => (
            <li key={p.id}>
              <Link href={`/products/${p.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                <div>
                  <div className="font-medium">{p.name}</div>
                  {p.summary && <div className="text-sm text-slate-500">{p.summary}</div>}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{p.phase}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{p.status}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
