import type { FeatureId } from '@/lib/types'
import { FEATURES } from '@/lib/features/registry'

export function FeatureButtons({
  onRun,
  running,
  disabled,
}: {
  onRun: (id: FeatureId) => void
  running: FeatureId | null
  disabled?: boolean
}) {
  return (
    <div className="space-y-2">
      {FEATURES.map((f) => {
        const flagship = !f.comingSoon
        const isRunning = running === f.id
        const soon = f.comingSoon === true
        return (
          <button
            key={f.id}
            disabled={disabled || soon}
            onClick={soon ? undefined : () => onRun(f.id)}
            aria-disabled={soon}
            className={`flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left transition disabled:cursor-not-allowed ${
              soon
                ? 'border-slate-200 bg-slate-50 opacity-70'
                : flagship
                  ? 'border-brand-300 bg-brand-50 hover:bg-brand-100 disabled:opacity-60'
                  : 'border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-60'
            }`}
          >
            <span className="text-lg leading-none">{f.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-900">{f.label}</span>
                {flagship && (
                  <span className="rounded bg-brand-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                    Flagship
                  </span>
                )}
                {soon && (
                  <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-500">
                    Soon
                  </span>
                )}
                {isRunning && (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand-300 border-t-brand-600" />
                )}
              </span>
              <span className="mt-0.5 block text-[12px] leading-snug text-slate-500">{f.blurb}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
