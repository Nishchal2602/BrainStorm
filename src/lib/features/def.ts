import type { ModelId, PageContext, ResearchDepth, Section, SourceRef } from '@/lib/types'

export interface ParsedResult {
  sections: Section[]
  copyText: string
}

export interface FeatureDef {
  id: import('@/lib/types').FeatureId
  label: string
  icon: string
  blurb: string
  output: 'structured' | 'research'
  /** json_schema for structured features. */
  jsonSchema?: object
  /** true → enable web_search; SW sets max_uses from Research Depth. */
  webSearch?: boolean
  /** Recommended model when settings.model === 'auto' (cost posture). */
  model: ModelId
  /** Max characters of page content to send (cost control), scaled by depth. */
  maxPageChars: (depth: ResearchDepth) => number
  /** When true, the feature is shown as "Soon" and is not clickable (MVP gating). */
  comingSoon?: boolean
  maxTokens: (depth: ResearchDepth) => number
  systemInstructions: string
  /** Builds the task portion of the user turn; the SW appends the page context block. */
  buildTask: (ctx: PageContext) => string
  parse: (raw: string, sources: SourceRef[]) => ParsedResult
}
