import type { PMMode } from '@/lib/types'
import { Segmented } from './Segmented'

export function ModeSelector({
  mode,
  onChange,
  disabled,
}: {
  mode: PMMode
  onChange: (m: PMMode) => void
  disabled?: boolean
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Mode
      </label>
      <Segmented<PMMode>
        value={mode}
        onChange={onChange}
        disabled={disabled}
        options={[
          { value: 'pm', label: 'PM' },
          { value: 'founder', label: 'Founder' },
          { value: 'product_analyst', label: 'Analyst' },
        ]}
      />
    </div>
  )
}
