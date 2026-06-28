import { prisma } from '@/lib/db'
import { requireMember, requireRole } from '@/server/access'
import { notFound } from '@/server/errors'
import { recordEvent } from '@/server/timeline'
import { assertTransition, REVIEW_FLOW } from '@/server/stateMachines'
import type { ReviewRunCreateInput } from '@/lib/validation'
import type { ReviewStatus } from '@/generated/prisma'

/** Create the execution-context shell (status Pending). Agents run in a later phase. */
export async function createReviewRun(
  userId: string,
  productId: string,
  input: ReviewRunCreateInput,
) {
  await requireRole(productId, userId, 'Editor')
  return prisma.$transaction(async (tx) => {
    const run = await tx.reviewRun.create({
      data: {
        productId,
        featureId: input.featureId ?? null,
        prdId: input.prdId ?? null,
        trigger: input.trigger ?? 'Manual',
        status: 'Pending',
      },
    })
    await recordEvent(tx, {
      productId,
      entityType: 'ReviewRun',
      entityId: run.id,
      eventType: 'review_run.created',
      actorId: userId,
      metadata: { trigger: run.trigger },
    })
    return run
  })
}

export async function getReviewRun(userId: string, id: string) {
  const run = await prisma.reviewRun.findUnique({ where: { id } })
  if (!run) throw notFound('Review run not found')
  await requireMember(run.productId, userId)
  return run
}

export async function updateReviewRunStatus(userId: string, id: string, status: ReviewStatus) {
  const run = await prisma.reviewRun.findUnique({ where: { id } })
  if (!run) throw notFound('Review run not found')
  await requireRole(run.productId, userId, 'Editor')
  assertTransition(REVIEW_FLOW, run.status, status, 'review run status')

  const data: Record<string, unknown> = { status }
  if (status === 'Running' && !run.startedAt) data.startedAt = new Date()
  if (status === 'Completed' || status === 'Failed') data.completedAt = new Date()

  return prisma.$transaction(async (tx) => {
    const updated = await tx.reviewRun.update({ where: { id }, data })
    await recordEvent(tx, {
      productId: run.productId,
      entityType: 'ReviewRun',
      entityId: id,
      eventType: 'review_run.status_changed',
      actorId: userId,
      metadata: { from: run.status, to: status },
    })
    return updated
  })
}
