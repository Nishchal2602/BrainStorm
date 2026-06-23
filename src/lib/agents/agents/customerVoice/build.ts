import type { CustomerVoiceEvidence, CustomerVoicePayload, Evidence, Finding } from '../../types'
import type { ExtractionResult } from './extract'
import type { ScoreResult } from './score'

export interface BuildOutput {
  payload: CustomerVoicePayload
  findings: Finding[]
  /** 0..1 for AgentResult.confidence. */
  confidence: number
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))

function dedupCap(items: string[], cap: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of items ?? []) {
    const s = raw.trim()
    if (!s) continue
    const k = s.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
    if (out.length >= cap) break
  }
  return out
}

/** Map CV evidence to the shared Evidence shape the synthesis findings consume. */
function toEvidence(e: CustomerVoiceEvidence): Evidence {
  return {
    snippet: e.quote,
    url: e.url,
    sourceType: e.subreddit ? `r/${e.subreddit}` : 'reddit',
  }
}

/** Assemble the payload + synthesis findings from scored themes + extraction extras. */
export function buildCustomerVoice(score: ScoreResult, extraction: ExtractionResult): BuildOutput {
  const payload: CustomerVoicePayload = {
    confidence: score.confidence,
    confidenceLabel: score.confidenceLabel,
    discussionCount: score.discussionCount,
    distinctSubreddits: score.distinctSubreddits,
    themes: score.themes,
    userSegments: dedupCap(extraction.userSegments, 8),
    sentimentSummary: extraction.sentimentSummary || score.confidenceReason,
    recommendation: score.recommendation,
  }

  const findings: Finding[] = score.themes.map((t) => ({
    title: t.name,
    detail: `${t.mentions} mention${t.mentions === 1 ? '' : 's'} across Reddit (severity ${t.severity}/10).`,
    kind: 'support',
    severity: t.severity >= 7 ? 'high' : t.severity >= 4 ? 'medium' : 'low',
    confidence: clamp01(t.severity / 10),
    evidence: t.evidence.slice(0, 3).map(toEvidence),
  }))

  return { payload, findings, confidence: score.confidence / 100 }
}
