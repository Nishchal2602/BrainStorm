import { prisma } from '@/lib/db'
import { requireMember, requireRole } from '@/server/access'
import { notFound } from '@/server/errors'
import { recordEvent } from '@/server/timeline'
import { assertTransition, DECISION_FLOW } from '@/server/stateMachines'
import type { DecisionCreateInput } from '@/lib/validation'
import type { DecisionStatus } from '@/generated/prisma'

export async function listDecisions(userId: string, productId: string) {
  await requireMember(productId, userId)
  return prisma.decision.findMany({ where: { productId }, orderBy: { createdAt: 'desc' } })
}

/** Create a decision in the Proposed state (the recommendation a review yields; approval later). */
export async function createDecision(
  userId: string,
  productId: string,
  input: DecisionCreateInput,
) {
  await requireRole(productId, userId, 'Editor')
  return prisma.$transaction(async (tx) => {
    const decision = await tx.decision.create({
      data: {
        productId,
        featureId: input.featureId ?? null,
        reviewRunId: input.reviewRunId ?? null,
        title: input.title,
        decision: input.decision,
        rationale: input.rationale ?? null,
        confidence: input.confidence ?? null,
        status: 'Proposed',
        ownerId: userId,
      },
    })
    await recordEvent(tx, {
      productId,
      entityType: 'Decision',
      entityId: decision.id,
      eventType: 'decision.proposed',
      actorId: userId,
      metadata: { title: decision.title },
    })
    return decision
  })
}

/** Move a decision along its lifecycle (approve/reject/supersede). Requires Admin+. */
export async function transitionDecision(userId: string, id: string, status: DecisionStatus) {
  const decision = await prisma.decision.findUnique({ where: { id } })
  if (!decision) throw notFound('Decision not found')
  await requireRole(decision.productId, userId, 'Admin')
  assertTransition(DECISION_FLOW, decision.status, status, 'decision status')

  const data: Record<string, unknown> = { status }
  if (status === 'Approved') {
    data.approvedBy = userId
    data.approvedAt = new Date()
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.decision.update({ where: { id }, data })
    await recordEvent(tx, {
      productId: decision.productId,
      entityType: 'Decision',
      entityId: id,
      eventType: `decision.${status.toLowerCase()}`,
      actorId: userId,
      metadata: { from: decision.status, to: status },
    })
    return updated
  })
}
