import type { ResearchDepth } from '@/lib/types'
import { Segmented } from './Segmented'

export function DepthSelector({
  depth,
  onChange,
  disabled,
}: {
  depth: ResearchDepth
  onChange: (d: ResearchDepth) => void
  disabled?: boolean
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Research depth · PM Review
      </label>
      <Segmented<ResearchDepth>
        value={depth}
        onChange={onChange}
        disabled={disabled}
        options={[
          { value: 'quick', label: 'Quick', sub: '1–2 min' },
          { value: 'standard', label: 'Standard', sub: '3–5 min' },
          { value: 'deep', label: 'Deep', sub: '5–10 min' },
        ]}
      />
    </div>
  )
}
