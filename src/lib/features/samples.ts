import type { FeatureId, SourceRef } from '@/lib/types'
import type { CompetitorPayload, CustomerVoicePayload } from '@/lib/agents/types'
import type { SuggestedPatch } from './pmReview'

/**
 * Canned model outputs for demo mode — no API call. Each sample is the RAW text
 * a feature's parse() expects, so demo mode exercises the real parsing + card
 * rendering pipeline (not hardcoded cards).
 */
export interface Sample {
  text: string
  sources: SourceRef[]
}

const PM_REVIEW = `<review>
  <strengths>
    <item>The extraction pipeline is decomposed into clear stages (detect → extract → truncate → prompt) with defined inputs and outputs.</item>
    <item>Side-panel feature gating is explicitly specified — only PM Review is active; other features show a "Soon" state.</item>
  </strengths>
  <critical>
    <issue>
      <title>No error behaviour defined for failed page extraction</title>
      <where>Section "Content Extraction" — describes the happy path only</where>
      <why>The PRD never states what the user sees when extraction returns empty or partial content (JS-heavy apps like Notion and Jira frequently do).</why>
      <impact>Engineering will invent fallback UX ad hoc; QA cannot write failure-path tests.</impact>
      <fix>Specify the user-visible state for empty extraction, partial extraction, and extraction timeout, plus whether a retry is offered.</fix>
      <example>If extraction returns under 200 characters, show "Couldn't read this page" with a Retry button; never send a near-empty document to the model.</example>
      <confidence>High</confidence>
      <patch>
        <action>append</action>
        <kind>list</kind>
        <targetHeading>Content Extraction</targetHeading>
        <content>Extraction failure handling:

- Empty extraction (&lt;200 characters): show "Couldn't read this page" with a Retry button; no API call is made.
- Partial extraction (page still loading): wait up to 2s for DOM settle, then extract once more; proceed with whatever is captured and flag the review as "partial page".
- Extraction timeout (&gt;5s): fail the run with "This page took too long to read — reload and retry."
- Retry is offered in every failure state and re-runs extraction only, not the review context flow.</content>
        <rationale>Defines the user-visible behaviour for every extraction failure mode so engineering does not invent fallback UX.</rationale>
        <confidence>85</confidence>
      </patch>
    </issue>
    <issue>
      <title>Review-run states are not enumerated</title>
      <where>Section "PM Review flow"</where>
      <why>The flow jumps from "user clicks Run" to "results render" with no intermediate states (queued, running, failed, rate-limited, cancelled).</why>
      <impact>State handling ends up implicit in component code; cancellation and re-run behaviour will be inconsistent.</impact>
      <fix>Enumerate the run states, the transitions between them, and what the user can do in each state.</fix>
      <confidence>High</confidence>
      <patch>
        <action>replace</action>
        <kind>table</kind>
        <targetHeading>PM Review flow</targetHeading>
        <content>Review-run state machine:

| State | Entered when | User can |
| --- | --- | --- |
| Idle | Panel opens / previous run cleared | Run review |
| Running | Run clicked and extraction succeeded | Cancel |
| Failed | Extraction, API, or parse error | Retry, view error detail |
| Rate-limited | Daily cap reached | Wait for reset (shown in message) |
| Complete | Results rendered | Copy, re-run, give feedback |

Transitions: Idle → Running → Complete or Failed; Running → Idle on Cancel; any state → Rate-limited when the cap trips. A re-run from Complete discards the previous result after confirmation.</content>
        <rationale>Enumerates the full state machine so cancellation and re-run behaviour are consistent across components.</rationale>
        <confidence>78</confidence>
      </patch>
    </issue>
  </critical>
  <medium>
    <issue>
      <title>Ambiguous behaviour when the user switches tabs mid-review</title>
      <where>Section "Side Panel" — "the panel follows the active tab"</where>
      <why>Unclear whether an in-flight review is cancelled, continues in the background, or re-binds to the new tab.</why>
      <impact>Race conditions between panel state and tab identity; results may render against the wrong page.</impact>
      <fix>Define the behaviour: reviews bind to the tab they started on; switching tabs shows that tab's last result, not the in-flight one.</fix>
      <confidence>Medium</confidence>
      <patch>
        <action>append</action>
        <kind>paragraph</kind>
        <targetHeading>Side Panel</targetHeading>
        <content>A review binds to the tab it was started on. If the user switches tabs while a review is in flight, the panel shows the newly active tab's last completed result (or its empty state) and the in-flight review continues in the background; its result is attached to the originating tab and shown when the user returns to it. Closing the originating tab cancels its in-flight review.</content>
        <rationale>Pins down tab-switch semantics so panel state can never render against the wrong page.</rationale>
        <confidence>66</confidence>
      </patch>
    </issue>
    <issue>
      <title>Rate-limit copy is unspecified</title>
      <where>Section "Cost Controls" mentions per-user daily caps</where>
      <why>The cap exists but the PRD does not say what the user sees when they hit it, or when the cap resets.</why>
      <impact>Engineering will hardcode a generic error; support burden when users think the product is broken.</impact>
      <fix>Specify the limit-reached message, whether it shows remaining quota, and the reset time (user's local midnight vs UTC).</fix>
      <confidence>High</confidence>
      <patch>
        <action>append</action>
        <kind>paragraph</kind>
        <targetHeading>Cost Controls</targetHeading>
        <content>When the daily cap is reached, the Run button is disabled and the panel shows: "Daily review limit reached — resets at midnight (your local time)." The message includes the count used (e.g. "10 of 10 reviews used today"). Remaining quota is shown in Settings at all times. The cap resets at the user's local midnight; quota state is stored client-side and reconciled with the proxy on each run.</content>
        <rationale>Specifies the exact limit-reached copy, quota visibility, and reset semantics engineering needs.</rationale>
        <confidence>40</confidence>
      </patch>
    </issue>
  </medium>
  <minor>
    <issue>
      <title>Copy-to-clipboard format is undefined</title>
      <where>Section "Results view"</where>
      <why>Cards are specified visually but the flattened clipboard format (markdown vs plain text) is not.</why>
      <impact>Minor rework if stakeholder tools (Slack, Jira) render the paste poorly.</impact>
      <fix>State the clipboard format and include one example paste for Slack.</fix>
      <confidence>Medium</confidence>
    </issue>
  </minor>
  <missing>
    <requirements>
      <item>Behaviour for non-English pages — reviewed in-language or translated? Product must decide; engineering cannot choose this.</item>
      <item>Maximum document size and the truncation rule the user is told about when a page exceeds it.</item>
    </requirements>
    <userFlows>
      <item>First-run flow when the user opens the panel on a page with no reviewable content (e.g. a dashboard).</item>
      <item>Recovery flow after a failed review — retry with same context, or re-enter the review context?</item>
    </userFlows>
    <edgeCases>
      <item>User triggers a review while a previous one is still running on the same tab.</item>
      <item>Page navigates (SPA route change) while a review is in flight.</item>
    </edgeCases>
    <acceptanceCriteria>
      <item>A PM Review on a 10k-character PRD completes and renders cards in under 20 seconds at standard depth.</item>
      <item>When extraction yields under 200 characters, the "Couldn't read this page" state is shown and no API call is made.</item>
      <item>Hitting the daily cap shows the limit message with reset time; the Run button is disabled until reset.</item>
    </acceptanceCriteria>
    <nonFunctional>
      <item>No latency budget is stated for the end-to-end review at each research depth.</item>
      <item>No logging/telemetry spec — which events are captured (run started/failed/copied) and where they are stored.</item>
    </nonFunctional>
  </missing>
  <questions>
    <product>
      <item>Can users re-run a review with edited context, or is each run independent?</item>
      <item>Is review history retained across browser restarts, and for how long?</item>
    </product>
    <engineering>
      <item>Should extraction retries be synchronous (blocking the run) or should the run fail fast and let the user retry?</item>
      <item>Is the per-user daily cap enforced client-side, proxy-side, or both?</item>
    </engineering>
  </questions>
  <score>
    <criticalIssues>2</criticalIssues>
    <mediumIssues>2</mediumIssues>
    <minorIssues>1</minorIssues>
    <readiness>58</readiness>
    <decision>Build with Changes</decision>
    <confidence>High</confidence>
    <rationale>The core flow and cost controls are well specified, but failure paths (extraction, run states, rate limits) are undefined and no feature has testable acceptance criteria. Resolving the two critical issues and adding the listed acceptance criteria would raise this to ready.</rationale>
  </score>
</review>`

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
      task: 'Draft a one-pager positioning Pocket PM for seed-stage PMs',
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
    'This page describes Pocket PM, an AI Chrome extension that helps Product Managers act on any page. The differentiator is PM Review — research-backed, graded insights — with summarization deliberately last. Recommended next step: validate which feature PMs will pay for before broadening scope.',
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

// --- Deep-analysis demo payloads (structured; power the tabbed review UI) ---

const ev = (quote: string, subreddit: string, postScore: number) => ({
  quote,
  subreddit,
  url: `https://www.reddit.com/r/${subreddit}`,
  postScore,
  commentScore: Math.round(postScore / 3),
  problemMatch: 8,
  personaMatch: 7,
  productMatch: 7,
  evidenceStrength: 7,
  engagementScore: 6,
  authorCredibility: 6,
  finalScore: 7,
})

export const SAMPLE_DEEP_VOICE: CustomerVoicePayload = {
  hypotheses: [
    {
      id: 'hyp-1',
      statement: 'PMs spend significant weekly time writing status updates leadership barely reads.',
      category: 'problem',
      verdict: 'supported',
      confidence: 62,
      evidenceQuality: 'High',
      supportingCount: 3,
      contradictingCount: 0,
      sourceBreadth: { distinctThreads: 3, distinctSubreddits: 2, distinctAuthors: 3 },
      supporting: [
        ev('I spend 4 hours every Friday writing updates nobody responds to.', 'ProductManagement', 41),
        ev('Status update theater is the worst part of my week.', 'prodmgmt', 18),
      ],
      contradicting: [],
    },
    {
      id: 'hyp-2',
      statement: 'PMs are willing to paste AI-generated artifacts into real stakeholder channels.',
      category: 'solution',
      verdict: 'mixed',
      confidence: 38,
      evidenceQuality: 'Medium',
      supportingCount: 2,
      contradictingCount: 1,
      sourceBreadth: { distinctThreads: 3, distinctSubreddits: 2, distinctAuthors: 3 },
      supporting: [ev('I already use ChatGPT for the first draft of every update.', 'ProductManagement', 25)],
      contradicting: [ev('I would never send AI output to execs without a full rewrite.', 'prodmgmt', 12)],
    },
    {
      id: 'hyp-3',
      statement: 'Context switching between docs, tickets and AI tools is a top productivity drain.',
      category: 'workflow',
      verdict: 'supported',
      confidence: 55,
      evidenceQuality: 'Medium',
      supportingCount: 2,
      contradictingCount: 0,
      sourceBreadth: { distinctThreads: 2, distinctSubreddits: 2, distinctAuthors: 2 },
      supporting: [ev('Half my day is lost re-finding context across Jira, Notion and Slack.', 'ProductManagement', 33)],
      contradicting: [],
    },
    {
      id: 'hyp-4',
      statement: 'PMs will pay for an AI review tool out of their own pocket.',
      category: 'market',
      verdict: 'insufficient_evidence',
      confidence: 15,
      evidenceQuality: 'Low',
      supportingCount: 0,
      contradictingCount: 0,
      sourceBreadth: { distinctThreads: 0, distinctSubreddits: 0, distinctAuthors: 0 },
      supporting: [],
      contradicting: [],
    },
  ],
  hypothesesEvaluated: 4,
  supportedCount: 2,
  mixedCount: 1,
  insufficientCount: 1,
  contradictedCount: 0,
  discussionCount: 21,
  distinctSubreddits: ['ProductManagement', 'prodmgmt'],
  overallConfidence: 46,
  overallConfidenceLabel: 'Medium',
  evidenceLevel: 'Limited evidence found',
  affectedUsers: [
    { segment: 'Mid-level PMs at B2B SaaS companies', mentions: 9 },
    { segment: 'Startup founders doing PM work', mentions: 4 },
  ],
}

const comp = (
  name: string,
  url: string,
  category: string,
  primaryJob: string,
  positioning: string,
  architecture: string,
  confidence: number,
  relationship: 'direct' | 'adjacent' | 'substitute',
) => ({
  name,
  url,
  category,
  primaryJob,
  positioning,
  architecture,
  confidence,
  relationship,
  capabilities: [],
  strengths: [],
  weaknesses: [],
})

export const SAMPLE_DEEP_COMPETITOR: CompetitorPayload = {
  landscape: {
    proposal: {
      category: 'AI PM Assistant',
      primaryJob: 'Review PRDs and generate PM artifacts in-context',
      architecture: 'Browser side panel over any page',
      positioning: 'An always-available senior PM reviewer inside the browser',
    },
    category: 'AI PM Assistant',
    maturity: 'Medium',
    competitors: [
      comp('ChatPRD', 'https://chatprd.ai', 'AI PRD Tools', 'Draft and improve PRDs with AI', 'The AI copilot for product managers.', 'Chat app over document templates', 88, 'direct'),
      comp('Zeda.io', 'https://zeda.io', 'AI Product Discovery', 'Turn feedback into validated product decisions', 'AI-powered product discovery platform.', 'Feedback aggregation + AI insights', 74, 'direct'),
      comp('WriteMyPRD', 'https://writemyprd.com', 'AI PRD Tools', 'Generate PRD drafts from prompts', 'The fastest way to write a PRD.', 'GPT template generator', 66, 'direct'),
      comp('Notion AI', 'https://notion.so/product/ai', 'Workspace AI', 'Write and summarize inside your docs', 'AI built into your workspace.', 'LLM embedded in the Notion editor', 92, 'adjacent'),
      comp('ChatGPT', 'https://chatgpt.com', 'General AI Assistant', 'General-purpose drafting and critique', 'Answers and creates anything.', 'General chat assistant', 95, 'substitute'),
    ],
    segments: [
      { name: 'AI PRD authoring', competitors: ['ChatPRD', 'WriteMyPRD'] },
      { name: 'Workspace AI', competitors: ['Notion AI', 'ChatGPT'] },
    ],
    capabilities: [],
    whiteSpace: [
      {
        opportunity: 'In-context review on any page — no copy-paste into a separate app',
        rationale: 'ChatPRD, WriteMyPRD and ChatGPT all require pasting the document into their own UI.',
      },
      {
        opportunity: 'Evidence-graded readiness score instead of generated prose',
        rationale: 'Authoring tools generate content; none grade implementation readiness with a score.',
      },
      {
        opportunity: 'Customer-voice validation wired into the review itself',
        rationale: 'No PRD tool checks the document’s claims against real user discussions.',
      },
    ],
    signals: [{ kind: 'crowded', message: 'AI PM tooling is a fast-moving, crowded space.' }],
  },
  productCategory: 'AI PM Assistant',
  competitorsFound: 5,
  differentiationScore: 62,
  differentiation: 'Medium',
  differentiationScores: {
    marketOverlap: 58,
    architectureNovelty: 71,
    capabilityDifferentiation: 55,
    positioningDifferentiation: 64,
  },
  recommendation:
    'Avoid competing on PRD generation — own the in-context review moment with graded, evidence-backed readiness.',
}

/** Canned patch for the demo-mode Retry flow (the sample's minor issue ships
 * without a <patch>, so the "No AI Draft generated" fallback is demoable). */
export const SAMPLE_RETRY_PATCH: SuggestedPatch = {
  version: 1,
  id: 'retry-sample',
  action: 'append',
  kind: 'list',
  targetHeading: 'Results view',
  content: `Copy-to-clipboard format:

- Copied content is GitHub-flavored markdown — headings, bullets, and tables survive pasting into Slack, Jira, Notion, and Confluence.
- Card order in the paste matches the on-screen order; severity chips flatten to a "[Critical]" prefix.
- Example Slack paste: "*PM Review — Build with Changes (58/100)*" followed by one bullet per issue title.`,
  rationale: 'States the clipboard format and gives the Slack example the issue asked for.',
  modelConfidence: 72,
}

export const SAMPLES: Record<FeatureId, Sample> = {
  // No web search in the readiness review → no sources card.
  pm_review: { text: PM_REVIEW, sources: [] },
  action_items: { text: ACTION_ITEMS, sources: [] },
  slack_update: { text: SLACK_UPDATE, sources: [] },
  summarize: { text: SUMMARIZE, sources: [] },
}
