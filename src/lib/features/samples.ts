import type { FeatureId, SourceRef } from '@/lib/types'

/**
 * Canned model outputs for demo mode — no API call. Each sample is the RAW text
 * a feature's parse() expects, so demo mode exercises the real parsing + card
 * rendering pipeline (not hardcoded cards).
 */
export interface Sample {
  text: string
  sources: SourceRef[]
}

const PM_REVIEW = `## Competitor
### Linear ships keyboard-first issue triage
Source Type: Competitor
Confidence: High
Insight: Linear's command palette lets a PM triage an issue in under three keystrokes; their changelog credits it with a ~40% drop in triage time — raising the bar for any Jira-centric workflow tool.
Source: https://linear.app/changelog

## Research / Academic
### The context-switching tax is large and measurable
Source Type: Research Paper
Confidence: High
Insight: A UC Irvine study (Mark et al.) found it takes ~23 minutes to refocus after an interruption, which directly supports a co-pilot that keeps PMs in-context instead of tab-switching to separate AI tools.
Source: https://www.ics.uci.edu/~gmark/chi08-mark.pdf

## Customer Voice
### PMs describe "status update theater"
Source Type: Customer Voice
Confidence: Medium
Insight: Recurring r/ProductManagement threads describe spending 3-5 hrs/week writing updates leadership barely reads — a concrete wedge for the Slack Update feature.
Source: https://www.reddit.com/r/ProductManagement

## Regulatory / Compliance
No strong external evidence found.

## Risks
- Distribution depends on Chrome Web Store review; an AI-content policy change could gate core features.
- Extraction quality varies on JS-heavy SaaS apps (Notion, Jira); thin extraction degrades every downstream feature.
- Single-LLM-provider reliance concentrates cost and availability risk.

## Implementation Considerations
- Per-site extraction adapters are needed for Jira/Notion/Linear DOM structures, which change without notice.
- Token/cost controls (caching, page caps) must hold as pages grow — a large Confluence space can blow the budget.
- Side-panel state must survive tab switches and single-page-app navigations.

## Critical Unknowns
- Target segment is undefined: indie PMs vs enterprise PMs have opposite willingness-to-pay and security needs.
- No success metric stated — is the goal activation, weekly retention, or artifacts generated per user?
- No evidence yet that PMs will trust AI-generated artifacts enough to paste them into real stakeholder channels.
- Pricing and packaging (per-seat vs usage-based) is unspecified.

## If I Were the PM
1. Run 5 problem-interviews with PMs this week to learn which feature they would pay for first.
2. Instrument activation as "first artifact copied" and set a 7-day retention target before adding features.
3. Pick one beachhead segment (e.g. seed-stage startup PMs) and tailor the default mode + sources to them.`

const ACTION_ITEMS = JSON.stringify({
  tasks: [
    {
      task: 'Interview 5 PMs about their weekly status-update workflow',
      owner: 'Nishchal',
      priority: 'High',
      dueDate: '2026-06-24',
    },
    {
      task: "Instrument 'artifact copied' as the activation event in analytics",
      owner: 'analytics',
      priority: 'High',
      dueDate: null,
    },
    {
      task: 'Draft a one-pager positioning PM Co-Pilot for seed-stage PMs',
      owner: null,
      priority: 'Medium',
      dueDate: null,
    },
  ],
})

const SLACK_UPDATE = JSON.stringify({
  completed: [
    'Shipped the side-panel UI with PM Review, Action Items, Slack Update, and Summarize',
    'Wired the Cloudflare Worker proxy so testers need no API key',
  ],
  inProgress: ['Tuning prompt caching + per-feature model selection to fit the $5 demo budget'],
  blocked: ["Waiting on the owner's Anthropic API key to enable live calls"],
})

const SUMMARIZE = JSON.stringify({
  executiveSummary:
    'This page describes PM Co-Pilot, an AI Chrome extension that helps Product Managers act on any page. The differentiator is PM Review — research-backed, graded insights — with summarization deliberately last. Recommended next step: validate which feature PMs will pay for before broadening scope.',
  keyInsights: [
    'Differentiation: leads with PM Review (research + evidence grading) rather than generic summarization → defensible wedge vs. ChatGPT/Perplexity.',
    'Distribution: an owner-key proxy removes the per-user key barrier → lower trial friction for demos and investors.',
    'Cost: per-feature model selection + prompt caching keep a $5 budget viable → ~50-100 demo calls.',
  ],
  risks: [
    'Adoption (Likelihood: Medium, Impact: High): PMs may not trust AI artifacts in real stakeholder channels.',
    'Extraction quality (Likelihood: Medium, Impact: Medium): JS-heavy SaaS pages degrade every feature.',
  ],
  openQuestions: [
    'Which single feature is the paid wedge — PM Review or Slack Update?',
    'What is the activation metric and its 7-day retention target?',
  ],
})

const PM_REVIEW_SOURCES: SourceRef[] = [
  { url: 'https://linear.app/changelog', title: 'Linear — Changelog' },
  { url: 'https://www.ics.uci.edu/~gmark/chi08-mark.pdf', title: 'Mark et al. — The Cost of Interrupted Work' },
  { url: 'https://www.reddit.com/r/ProductManagement', title: 'r/ProductManagement' },
]

export const SAMPLES: Record<FeatureId, Sample> = {
  pm_review: { text: PM_REVIEW, sources: PM_REVIEW_SOURCES },
  action_items: { text: ACTION_ITEMS, sources: [] },
  slack_update: { text: SLACK_UPDATE, sources: [] },
  summarize: { text: SUMMARIZE, sources: [] },
}
