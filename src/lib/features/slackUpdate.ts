import type { Section } from '@/lib/types'
import type { FeatureDef, ParsedResult } from './def'
import { GROUNDING_RULES } from './quality'
import { parseJsonObject } from './parse'

interface SlackUpdate {
  completed: string[]
  inProgress: string[]
  blocked: string[]
}

const SCHEMA = {
  type: 'object',
  properties: {
    completed: { type: 'array', items: { type: 'string' } },
    inProgress: { type: 'array', items: { type: 'string' } },
    blocked: { type: 'array', items: { type: 'string' } },
  },
  required: ['completed', 'inProgress', 'blocked'],
  additionalProperties: false,
}

function block(title: string, items: string[]): string {
  return `${title}:\n${items.length ? items.map((i) => `• ${i}`).join('\n') : '• —'}`
}

function parse(raw: string): ParsedResult {
  const u = parseJsonObject<SlackUpdate>(raw)
  const sections: Section[] = [
    { heading: 'Completed', bullets: u.completed },
    { heading: 'In Progress', bullets: u.inProgress },
    { heading: 'Blocked', tone: 'risk', bullets: u.blocked },
  ]
  const copyText = [
    '🚀 Progress Update',
    '',
    block('Completed', u.completed),
    '',
    block('In Progress', u.inProgress),
    '',
    block('Blocked', u.blocked),
  ].join('\n')
  return { sections, copyText }
}

export const slackUpdate: FeatureDef = {
  id: 'slack_update',
  label: 'Slack Update',
  icon: '💬',
  blurb: 'Turn the page into a Completed / In Progress / Blocked status post.',
  output: 'structured',
  jsonSchema: SCHEMA,
  model: 'claude-haiku-4-5',
  maxPageChars: () => 12_000,
  comingSoon: true,
  maxTokens: () => 2048,
  systemInstructions: `Summarize the current state of work on this page as a Slack status update.

${GROUNDING_RULES}

State definitions (use precisely):
- Completed = shipped / merged / live to users (not just "done coding").
- In Progress = actively being worked: PR open, in review, code committed, in QA.
- Blocked = waiting on a decision, dependency, or resource.

Each item is one line: start with the concrete outcome/action and include impact where known. Use empty arrays for empty buckets.
GOOD: "Shipped OAuth email verification — cuts account-takeover risk for new signups."
BAD: "Made progress on auth." / "Still working on performance."`,
  buildTask: () => 'Produce a Slack progress update from the page below.',
  parse,
}
