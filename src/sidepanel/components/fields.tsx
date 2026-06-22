/** Single-line text input with a live character counter. Never a textarea —
 * concise context only (no paragraph answers). */
export function TextField({
  label,
  value,
  onChange,
  placeholder,
  maxLength = 150,
  required,
  error,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  maxLength?: number
  required?: boolean
  error?: string
  hint?: string
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="text-[12px] font-medium text-slate-700">
          {label}
          {required && <span className="text-rose-500"> *</span>}
        </label>
        <span className="text-[10px] text-slate-400">
          {value.length}/{maxLength}
        </span>
      </div>
      <input
        type="text"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 w-full rounded-md border px-2 py-1.5 text-sm outline-none focus:border-brand-500 ${
          error ? 'border-rose-300' : 'border-slate-300'
        }`}
      />
      {error ? (
        <p className="mt-0.5 text-[11px] text-rose-600">{error}</p>
      ) : (
        hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>
      )}
    </div>
  )
}

/** Styled native dropdown — fits long option lists in a narrow side panel. */
export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  required,
  placeholder,
  allowEmpty = true,
  error,
}: {
  label: string
  value: T | ''
  onChange: (v: T) => void
  options: Record<string, string>
  required?: boolean
  placeholder?: string
  allowEmpty?: boolean
  error?: string
}) {
  return (
    <div>
      <label className="text-[12px] font-medium text-slate-700">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={`mt-1 w-full rounded-md border bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-500 ${
          error ? 'border-rose-300' : 'border-slate-300'
        } ${value ? 'text-slate-900' : 'text-slate-400'}`}
      >
        {allowEmpty && <option value="">{placeholder ?? 'Select…'}</option>}
        {Object.entries(options).map(([k, lbl]) => (
          <option key={k} value={k} className="text-slate-900">
            {lbl}
          </option>
        ))}
      </select>
      {error && <p className="mt-0.5 text-[11px] text-rose-600">{error}</p>}
    </div>
  )
}
