import type { CustomerVoicePayload, Evidence, Finding, HypothesisEvidence } from '../../types'
import type { ScoreResult } from './score'

export interface BuildOutput {
  payload: CustomerVoicePayload
  findings: Finding[]
  /** 0..1 for AgentResult.confidence. */
  confidence: number
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))

/** Map CV evidence to the shared Evidence shape the synthesis findings consume. */
function toEvidence(e: HypothesisEvidence): Evidence {
  return { snippet: e.quote, url: e.url, sourceType: e.subreddit ? `r/${e.subreddit}` : 'reddit' }
}

/** Assemble the hypotheses payload + synthesis findings. Findings speak only about
 * *evidence* (verdicts/counts), never about whether demand exists. */
export function buildCustomerVoice(score: ScoreResult): BuildOutput {
  const payload: CustomerVoicePayload = {
    hypotheses: score.hypotheses,
    hypothesesEvaluated: score.hypothesesEvaluated,
    supportedCount: score.supportedCount,
    mixedCount: score.mixedCount,
    insufficientCount: score.insufficientCount,
    contradictedCount: score.contradictedCount,
    discussionCount: score.discussionCount,
    distinctSubreddits: score.distinctSubreddits,
    overallConfidence: score.overallConfidence,
    overallConfidenceLabel: score.overallConfidenceLabel,
    evidenceLevel: score.evidenceLevel,
    affectedUsers: score.affectedUsers,
  }

  const findings: Finding[] = score.hypotheses.map((h) => {
    const s = h.supportingCount
    const ct = h.contradictingCount
    const insufficient = h.verdict === 'insufficient_evidence'
    // kind tracks the evidence balance — absence/insufficient is NEVER tagged
    // 'contradict' (that would launder absence into evidence of absence).
    const kind: Finding['kind'] = insufficient
      ? 'insight'
      : s > ct
        ? 'support'
        : ct > s
          ? 'contradict'
          : 'insight'
    const detail = insufficient
      ? 'Insufficient public evidence — reflects discussion availability, not contradiction. Validate directly with target users.'
      : `Verdict: ${h.verdict} (confidence ${h.confidence}/100). ` +
        `${s} supporting vs ${ct} contradicting discussion(s) ` +
        `across ${h.sourceBreadth.distinctThreads} thread(s).` +
        (ct > 0 ? ' Contradicting evidence present.' : '')
    const severity: Finding['severity'] = insufficient
      ? 'low'
      : h.verdict === 'supported'
        ? h.confidence >= 70
          ? 'high'
          : 'medium'
        : 'medium' // mixed / contradicted
    return {
      title: h.statement,
      detail,
      kind,
      severity,
      confidence: clamp01(h.confidence / 100),
      evidence: [...h.supporting, ...h.contradicting].slice(0, 3).map(toEvidence),
    }
  })

  return { payload, findings, confidence: score.overallConfidence / 100 }
}
