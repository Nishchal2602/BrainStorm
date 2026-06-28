import { z } from 'zod'
import {
  DecisionStatus,
  FeatureCategory,
  FeatureStage,
  FeatureStatus,
  MemberRole,
  Priority,
  ProductPhase,
  ProductStatus,
  ReviewStatus,
  ReviewTrigger,
} from '@/generated/prisma'

export const ProductCreate = z.object({
  name: z.string().trim().min(1).max(120),
  summary: z.string().trim().max(2000).optional(),
  vision: z.string().trim().max(4000).optional(),
  problemStatement: z.string().trim().max(4000).optional(),
  targetPersona: z.string().trim().max(500).optional(),
  phase: z.enum(ProductPhase).optional(),
})
export const ProductUpdate = ProductCreate.partial().extend({
  status: z.enum(ProductStatus).optional(),
})

export const FeatureCreate = z.object({
  name: z.string().trim().min(1).max(160),
  summary: z.string().trim().max(2000).optional(),
  problemStatement: z.string().trim().max(4000).optional(),
  proposedSolution: z.string().trim().max(4000).optional(),
  priority: z.enum(Priority).optional(),
  category: z.enum(FeatureCategory).optional(),
  successMetric: z.string().trim().max(1000).optional(),
  targetRelease: z.string().trim().max(120).optional(),
})
export const FeatureUpdate = FeatureCreate.partial().extend({
  stage: z.enum(FeatureStage).optional(),
  status: z.enum(FeatureStatus).optional(),
})

export const ReviewRunCreate = z.object({
  featureId: z.uuid().optional(),
  prdId: z.uuid().optional(),
  trigger: z.enum(ReviewTrigger).optional(),
})
export const ReviewRunUpdate = z.object({ status: z.enum(ReviewStatus) })

export const DecisionCreate = z.object({
  title: z.string().trim().min(1).max(200),
  decision: z.string().trim().min(1).max(4000),
  rationale: z.string().trim().max(4000).optional(),
  featureId: z.uuid().optional(),
  reviewRunId: z.uuid().optional(),
  confidence: z.number().min(0).max(1).optional(),
})
export const DecisionTransition = z.object({ status: z.enum(DecisionStatus) })

export const MemberAdd = z.object({ email: z.email(), role: z.enum(MemberRole).optional() })

export type ProductCreateInput = z.infer<typeof ProductCreate>
export type ProductUpdateInput = z.infer<typeof ProductUpdate>
export type FeatureCreateInput = z.infer<typeof FeatureCreate>
export type FeatureUpdateInput = z.infer<typeof FeatureUpdate>
export type ReviewRunCreateInput = z.infer<typeof ReviewRunCreate>
export type DecisionCreateInput = z.infer<typeof DecisionCreate>
