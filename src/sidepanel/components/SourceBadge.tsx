import type { PageInfo } from '@/lib/messaging/types'
import { SOURCE_LABEL } from '@/lib/context/sourceDetect'

export function SourceBadge({ info, loading }: { info: PageInfo | null; loading: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${loading ? 'bg-slate-300' : info ? 'bg-emerald-500' : 'bg-rose-400'}`}
        />
        <span className="text-xs font-medium text-slate-500">
          {loading ? 'Reading page…' : 'Detected'}
        </span>
        {info && (
          <span className="rounded bg-brand-50 px-1.5 py-0.5 text-xs font-semibold text-brand-700">
            {SOURCE_LABEL[info.source]}
          </span>
        )}
        {!loading && !info && <span className="text-xs text-rose-500">No page</span>}
      </div>
      {info && <p className="mt-1 truncate text-[12px] text-slate-600" title={info.title}>{info.title}</p>}
    </div>
  )
}
