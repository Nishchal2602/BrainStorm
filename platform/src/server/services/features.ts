import { prisma } from '@/lib/db'
import { requireMember, requireRole } from '@/server/access'
import { notFound } from '@/server/errors'
import { recordEvent } from '@/server/timeline'
import { assertTransition, FEATURE_STAGE_FLOW } from '@/server/stateMachines'
import type { FeatureCreateInput, FeatureUpdateInput } from '@/lib/validation'

async function loadFeature(featureId: string) {
  const f = await prisma.feature.findUnique({ where: { id: featureId } })
  if (!f) throw notFound('Feature not found')
  return f
}

export async function listFeatures(userId: string, productId: string) {
  await requireMember(productId, userId)
  return prisma.feature.findMany({ where: { productId }, orderBy: { updatedAt: 'desc' } })
}

export async function createFeature(userId: string, productId: string, input: FeatureCreateInput) {
  await requireRole(productId, userId, 'Editor')
  return prisma.$transaction(async (tx) => {
    const feature = await tx.feature.create({ data: { ...input, productId, ownerId: userId } })
    await recordEvent(tx, {
      productId,
      entityType: 'Feature',
      entityId: feature.id,
      eventType: 'feature.created',
      actorId: userId,
      metadata: { name: feature.name },
    })
    return feature
  })
}

export async function getFeature(userId: string, featureId: string) {
  const feature = await loadFeature(featureId)
  await requireMember(feature.productId, userId)
  return feature
}

export async function updateFeature(userId: string, featureId: string, input: FeatureUpdateInput) {
  const feature = await loadFeature(featureId)
  await requireRole(feature.productId, userId, 'Editor')
  const stageChanged = !!input.stage && input.stage !== feature.stage
  if (stageChanged) assertTransition(FEATURE_STAGE_FLOW, feature.stage, input.stage!, 'feature stage')

  return prisma.$transaction(async (tx) => {
    const updated = await tx.feature.update({ where: { id: featureId }, data: input })
    await recordEvent(tx, {
      productId: feature.productId,
      entityType: 'Feature',
      entityId: feature.id,
      eventType: stageChanged ? 'feature.stage_changed' : 'feature.updated',
      actorId: userId,
      metadata: stageChanged ? { from: feature.stage, to: input.stage } : undefined,
    })
    return updated
  })
}
