import type { DetectedSource } from '@/lib/types'

/**
 * Per-source context template: a short instruction that frames how the PM should
 * read this kind of page. Layered into the system prompt above the feature
 * instructions, below the PM-mode persona.
 */
const TEMPLATES: Record<DetectedSource, string> = {
  jira:
    'The user is viewing a Jira ticket. Read it as a PM reviewing a unit of work: clarify the underlying user problem, scope, acceptance criteria, and how it ladders up to product goals.',
  confluence:
    'The user is viewing a Confluence page (often a spec, PRD, or decision doc). Read it as a PM reviewing product requirements: assess clarity of problem, goals, and decisions.',
  notion:
    'The user is viewing a Notion document (often a PRD, plan, or notes). Read it as a PM reviewing product requirements and planning artifacts.',
  linear:
    'The user is viewing a Linear issue or project. Read it as a PM tracking delivery: understand status, scope, and risks to the roadmap.',
  gdocs:
    'The user is viewing a Google Doc (often a PRD, brief, or strategy doc). Read it as a PM reviewing a written product artifact.',
  generic:
    'The user is viewing a web page relevant to their product work (it may be documentation, a competitor site, an article, or feedback). Read it through a product-management lens.',
}

export function sourceTemplate(source: DetectedSource): string {
  return TEMPLATES[source]
}
