import type { Confidence, Section, SectionTone } from '@/lib/types'

const toneAccent: Record<SectionTone, string> = {
  default: 'border-l-slate-300',
  insight: 'border-l-brand-500',
  risk: 'border-l-rose-400',
  implementation: 'border-l-sky-400',
  unknown: 'border-l-amber-400',
  recommendation: 'border-l-emerald-500',
  sources: 'border-l-slate-300',
}

const confColor: Record<Confidence, string> = {
  High: 'bg-emerald-100 text-emerald-800',
  Medium: 'bg-amber-100 text-amber-800',
  Low: 'bg-slate-100 text-slate-700',
}

const URL_RE = /(https?:\/\/[^\s)]+)/g

function Linkify({ text }: { text: string }) {
  const parts = text.split(URL_RE)
  return (
    <>
      {parts.map((p, i) =>
        URL_RE.test(p) ? (
          <a
            key={i}
            href={p}
            target="_blank"
            rel="noreferrer"
            className="text-brand-600 underline break-all hover:text-brand-700"
          >
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}

export function Card({ section }: { section: Section }) {
  const tone = section.tone ?? 'default'
  return (
    <div className={`rounded-lg border border-slate-200 border-l-4 ${toneAccent[tone]} bg-white p-3 shadow-sm`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{section.heading}</h3>
        {section.evidenceType && (
          <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700">
            {section.evidenceType}
          </span>
        )}
        {section.confidence && (
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${confColor[section.confidence]}`}>
            {section.confidence} confidence
          </span>
        )}
      </div>

      {section.body && (
        <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700">
          <Linkify text={section.body} />
        </p>
      )}

      {section.bullets && section.bullets.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-slate-700">
          {section.bullets.map((b, i) => (
            <li key={i}>
              <Linkify text={b} />
            </li>
          ))}
        </ul>
      )}

      {section.sourceUrl && (
        <a
          href={section.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block break-all text-[11px] text-brand-600 underline hover:text-brand-700"
        >
          {section.sourceUrl}
        </a>
      )}
    </div>
  )
}
