import type { CustomerVoiceHypothesis, CustomerVoicePayload } from '@/lib/agents/types'
import { claimSource } from '@/lib/analytics'
import { Accordion, Chip, EmptyState, Thumbs, type ChipTone } from './bits'

// Voice pane: Final Verdict → validation counters → one accordion per claim.
// Quotes stay hidden until a claim is expanded (progressive disclosure).

const VERDICT: Record<CustomerVoiceHypothesis['verdict'], { label: string; tone: ChipTone; icon: string }> = {
  supported: { label: 'Supported', tone: 'emerald', icon: '✓' },
  mixed: { label: 'Mixed', tone: 'amber', icon: '⚠' },
  contradicted: { label: 'Contradicted', tone: 'rose', icon: '⊘' },
  insufficient_evidence: { label: 'No Evidence', tone: 'slate', icon: '✕' },
}

function Counter({ icon, count, label, color }: { icon: string; count: number; label: string; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`text-sm ${color}`}>{icon}</span>
      <div className="leading-tight">
        <div className="text-[13px] font-semibold text-slate-900">{count}</div>
        <div className="text-[10px] text-slate-500">{label}</div>
      </div>
    </div>
  )
}

function Claim({ h, index, reviewId, url }: { h: CustomerVoiceHypothesis; index: number; reviewId?: string; url?: string }) {
  const v = VERDICT[h.verdict]
  const quotes = h.supporting.slice(0, 3)
  return (
    <Accordion
      title={`Claim ${index + 1}`}
      meta={
        <span className="flex items-center gap-1.5">
          <Chip tone={v.tone}>{v.label}</Chip>
          <span className="font-mono text-[11px] text-slate-400">{Math.round(h.confidence)}%</span>
        </span>
      }
    >
      <div className="px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[13px] leading-snug text-slate-800">{h.statement}</p>
          <Thumbs source={claimSource(h)} reviewId={reviewId} url={url} />
        </div>
        <p className="mt-1.5 font-mono text-[10px] text-slate-400">
          Evidence quality: {h.evidenceQuality} · {h.sourceBreadth.distinctThreads} threads ·{' '}
          {h.sourceBreadth.distinctSubreddits} subreddits · {h.sourceBreadth.distinctAuthors} authors
        </p>
        {quotes.length > 0 && (
          <div className="mt-2 space-y-2">
            {quotes.map((q, i) => (
              <blockquote key={i} className="border-l-2 border-slate-200 pl-2.5">
                <p className="text-xs italic leading-relaxed text-slate-600">“{q.quote}”</p>
                <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                  — r/{q.subreddit} (↑{q.commentScore || q.postScore})
                  {q.url && (
                    <>
                      {' · '}
                      <a href={q.url} target="_blank" rel="noreferrer" className="text-brand-600 underline">
                        source
                      </a>
                    </>
                  )}
                </p>
              </blockquote>
            ))}
          </div>
        )}
        {h.contradictingCount > 0 && (
          <p className="mt-2 text-[11px] text-rose-600">
            {h.contradictingCount} contradicting discussion{h.contradictingCount === 1 ? '' : 's'} found.
          </p>
        )}
      </div>
    </Accordion>
  )
}

export function VoiceTab({
  voice,
  verdict,
  reviewId,
  url,
  onRunDeep,
}: {
  voice?: CustomerVoicePayload
  verdict?: string
  reviewId?: string
  url?: string
  onRunDeep: () => void
}) {
  if (!voice) {
    return (
      <EmptyState
        icon="💬"
        title="No customer evidence yet"
        body="Deep Analysis validates the PRD's claims against real customer discussions and grades the evidence."
        onRunDeep={onRunDeep}
      />
    )
  }

  return (
    <div className="space-y-3">
      {/* Final Verdict (synthesis) */}
      {verdict && (
        <section className="rounded-lg border border-slate-200 border-l-4 border-l-emerald-500 bg-white p-3">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-[15px] font-bold tracking-tight text-slate-900">Final Verdict</h3>
            <Thumbs source={{ agent: 'customer_voice', category: 'verdict', title: 'Final Verdict' }} reviewId={reviewId} url={url} />
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">{verdict}</p>
        </section>
      )}

      {/* Validation summary — visual counters, not paragraphs */}
      <section className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-slate-900">
            Customer Validation — {voice.hypothesesEvaluated} hypothes{voice.hypothesesEvaluated === 1 ? 'is' : 'es'}
          </h3>
          <Chip tone="slate">{voice.overallConfidenceLabel} confidence</Chip>
        </div>
        <div className="mt-2.5 grid grid-cols-4 gap-2">
          <Counter icon="✓" count={voice.supportedCount} label="Supported" color="text-emerald-500" />
          <Counter icon="⚠" count={voice.mixedCount} label="Mixed" color="text-amber-500" />
          <Counter icon="⊘" count={voice.contradictedCount} label="Contradicted" color="text-rose-500" />
          <Counter icon="✕" count={voice.insufficientCount} label="No evidence" color="text-slate-400" />
        </div>
        <p className="mt-2.5 border-t border-slate-100 pt-2 font-mono text-[10px] text-slate-400">
          {voice.evidenceLevel} · {voice.overallConfidence}% overall · {voice.discussionCount} discussions ·{' '}
          {voice.distinctSubreddits.length} subreddits
        </p>
      </section>

      {/* Claims */}
      {voice.hypotheses.map((h, i) => (
        <Claim key={h.id || i} h={h} index={i} reviewId={reviewId} url={url} />
      ))}
    </div>
  )
}
