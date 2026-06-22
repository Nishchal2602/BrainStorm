export function Loading({ label }: { label: string }) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 text-sm text-slate-600">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
        {label}
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="h-3 w-1/3 animate-pulse rounded bg-slate-200" />
          <div className="mt-2 h-2.5 w-full animate-pulse rounded bg-slate-100" />
          <div className="mt-1.5 h-2.5 w-5/6 animate-pulse rounded bg-slate-100" />
        </div>
      ))}
    </div>
  )
}
