import type { Section } from '@/lib/types'
import type { FeatureDef, ParsedResult } from './def'
import { GROUNDING_RULES } from './quality'
import { parseJsonObject, sectionsToCopyText } from './parse'

interface Task {
  task: string
  owner: string | null
  priority: string | null
  dueDate: string | null
}

const SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          task: { type: 'string' },
          owner: { type: ['string', 'null'] },
          priority: { type: ['string', 'null'] },
          dueDate: { type: ['string', 'null'] },
        },
        required: ['task', 'owner', 'priority', 'dueDate'],
        additionalProperties: false,
      },
    },
  },
  required: ['tasks'],
  additionalProperties: false,
}

function fmtTask(t: Task): string {
  const meta = [
    t.owner ? `@${t.owner}` : '',
    t.priority ? t.priority : '',
    t.dueDate ? `due ${t.dueDate}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  return meta ? `${t.task} — ${meta}` : t.task
}

function parse(raw: string): ParsedResult {
  const { tasks } = parseJsonObject<{ tasks: Task[] }>(raw)
  const sections: Section[] = [
    tasks.length
      ? { heading: 'Action Items', bullets: tasks.map(fmtTask) }
      : { heading: 'Action Items', body: 'No action items found on this page.' },
  ]
  return { sections, copyText: sectionsToCopyText('Action Items', sections) }
}

export const actionItems: FeatureDef = {
  id: 'action_items',
  label: 'Action Items',
  icon: '✅',
  blurb: 'Extract tasks with owners, priority, and due dates.',
  output: 'structured',
  jsonSchema: SCHEMA,
  model: 'claude-haiku-4-5',
  maxPageChars: () => 12_000,
  comingSoon: true,
  maxTokens: () => 2048,
  systemInstructions: `Extract concrete action items from the page.

${GROUNDING_RULES}

Each action item MUST be:
- ATOMIC: one person can own it and complete it in <= 2 weeks (ideally 1).
- TESTABLE: you can verify it's done — not a vague goal ("improve engagement", "investigate churn").
- GROUNDED: stated in or directly implied by the page. Do not invent tasks.

OWNER: infer a real person/team named on the page; otherwise null.
PRIORITY (Impact x Urgency / Effort): High = unblocks other work or fixes a critical issue (cap at 1-2 items); Medium = important, 2-4 week horizon; Low = nice-to-have. If unstated, infer from urgency cues ("ASAP", "Q2 goal") or blocking nature.
DUE DATE: use a stated date; "ASAP"/"urgent" -> infer 3-5 business days; otherwise null.
If a task is larger than ~2 weeks, split it into atomic sub-tasks.

GOOD: "Interview 5 enterprise customers about churn (segment: <50% MAU)" — owner: Sarah, priority: High.
BAD: "Improve onboarding" (vague, not testable, no owner).`,
  buildTask: () => 'Extract the action items from the page below.',
  parse,
}
