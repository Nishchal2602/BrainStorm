import {
  DecisionStatus,
  FeatureStage,
  PrdStatus,
  ProductStatus,
  ReviewStatus,
} from '@/generated/prisma'
import { unprocessable } from '../errors'

/** Allowed forward transitions per lifecycle. Staying in the same state is always allowed. */
export const FEATURE_STAGE_FLOW: Record<FeatureStage, FeatureStage[]> = {
  Ideation: ['Discovery'],
  Discovery: ['Validation'],
  Validation: ['Design'],
  Design: ['Development'],
  Development: ['Testing'],
  Testing: ['Released'],
  Released: [],
}

export const PRD_FLOW: Record<PrdStatus, PrdStatus[]> = {
  Draft: ['Submitted'],
  Submitted: ['Reviewed', 'Draft'],
  Reviewed: ['Superseded'],
  Superseded: [],
}

export const REVIEW_FLOW: Record<ReviewStatus, ReviewStatus[]> = {
  Pending: ['Running'],
  Running: ['Completed', 'Failed'],
  Completed: [],
  Failed: ['Pending'], // allow retry
}

export const DECISION_FLOW: Record<DecisionStatus, DecisionStatus[]> = {
  Draft: ['Proposed'],
  Proposed: ['Approved', 'Rejected'],
  Approved: ['Superseded'],
  Rejected: ['Superseded'],
  Superseded: [],
}

export const PRODUCT_STATUS_FLOW: Record<ProductStatus, ProductStatus[]> = {
  Active: ['Paused', 'Archived'],
  Paused: ['Active', 'Archived'],
  Archived: [],
}

export function canTransition<T extends string>(flow: Record<T, T[]>, from: T, to: T): boolean {
  return from === to || (flow[from]?.includes(to) ?? false)
}

/** Throw 422 if `from → to` is not a legal transition for this lifecycle. */
export function assertTransition<T extends string>(
  flow: Record<T, T[]>,
  from: T,
  to: T,
  label: string,
): void {
  if (!canTransition(flow, from, to)) {
    throw unprocessable(`Illegal ${label} transition: ${from} → ${to}`)
  }
}
