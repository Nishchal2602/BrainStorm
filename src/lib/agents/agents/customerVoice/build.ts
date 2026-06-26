import type { ClaimEvidence, CustomerVoicePayload, Evidence, Finding } from '../../types'
import type { ScoreResult } from './score'

export interface BuildOutput {
  payload: CustomerVoicePayload
  findings: Finding[]
  /** 0..1 for AgentResult.confidence. */
  confidence: number
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))

/** Map CV evidence to the shared Evidence shape the synthesis findings consume. */
function toEvidence(e: ClaimEvidence): Evidence {
  return { snippet: e.quote, url: e.url, sourceType: e.subreddit ? `r/${e.subreddit}` : 'reddit' }
}

/** Assemble the claims payload + synthesis findings. Findings speak only about
 * *evidence* (verdicts/counts), never about whether demand exists. */
export function buildCustomerVoice(score: ScoreResult): BuildOutput {
  const payload: CustomerVoicePayload = {
    claims: score.claims,
    claimsEvaluated: score.claimsEvaluated,
    discussionCount: score.discussionCount,
    distinctSubreddits: score.distinctSubreddits,
    overallConfidence: score.overallConfidence,
    overallConfidenceLabel: score.overallConfidenceLabel,
    evidenceLevel: score.evidenceLevel,
    affectedUsers: score.affectedUsers,
  }

  const findings: Finding[] = score.claims.map((c) => {
    const s = c.supportingCount
    const ct = c.contradictingCount
    const noEvidence = s === 0 && ct === 0
    // kind tracks the actual evidence balance — absence/weak/mixed support is NOT
    // contradiction, so it is never tagged 'contradict' for the synthesizer. 'contradict'
    // is reserved for claims where located evidence genuinely outweighs support.
    const kind: Finding['kind'] = s > ct ? 'support' : ct > s ? 'contradict' : 'insight'
    const detail = noEvidence
      ? 'No public evidence located for this claim — this reflects discussion availability, not contradiction. Validate directly with target users.'
      : `Verdict: ${c.verdict} (confidence ${c.confidence}/100). ` +
        `${s} supporting vs ${ct} contradicting discussion(s) ` +
        `across ${c.sourceBreadth.distinctThreads} thread(s).` +
        (ct > 0 ? ' Contradicting evidence present.' : '')
    // severity = strength of the *located* signal. Absence of evidence is low, never
    // high — it must not read to the decision engine as a strong negative signal.
    const severity: Finding['severity'] = noEvidence
      ? 'low'
      : c.verdict === 'Strongly Supported'
        ? 'high'
        : c.verdict === 'Supported' || c.verdict === 'Mixed Evidence' || ct > s
          ? 'medium'
          : 'low'
    return {
      title: c.claim,
      detail,
      kind,
      severity,
      confidence: clamp01(c.confidence / 100),
      evidence: [...c.supporting, ...c.contradicting].slice(0, 3).map(toEvidence),
    }
  })

  return { payload, findings, confidence: score.overallConfidence / 100 }
}
