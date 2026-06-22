interface Option<T extends string> {
  value: T
  label: string
  sub?: string
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: Option<T>[]
  value: T
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <div className="flex rounded-md border border-slate-300 bg-slate-50 p-0.5">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`flex-1 rounded px-2 py-1 text-center text-xs font-medium transition disabled:opacity-50 ${
              active ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className="block leading-tight">{o.label}</span>
            {o.sub && <span className="block text-[10px] font-normal text-slate-400">{o.sub}</span>}
          </button>
        )
      })}
    </div>
  )
}
