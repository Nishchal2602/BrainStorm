import type { FeatureId } from '@/lib/types'
import type { FeatureDef } from './def'
import { pmReview } from './pmReview'
import { actionItems } from './actionItems'
import { slackUpdate } from './slackUpdate'
import { summarize } from './summarize'

export type { FeatureDef, ParsedResult } from './def'

// Order matters: PM Review is the flagship (top), Summarize is intentionally last.
export const FEATURES: FeatureDef[] = [pmReview, actionItems, slackUpdate, summarize]

export function getFeature(id: FeatureId): FeatureDef | undefined {
  return FEATURES.find((f) => f.id === id)
}
