import { prisma } from '@/lib/db'
import type { Prisma, TimelineEntityType } from '@/generated/prisma'

/** A Prisma client or an interactive-transaction client. */
type Db = typeof prisma | Prisma.TransactionClient

export interface TimelineInput {
  productId: string
  entityType: TimelineEntityType
  entityId: string
  /** Open vocabulary, e.g. "product.created", "feature.stage_changed", "decision.proposed". */
  eventType: string
  actorId?: string | null
  metadata?: Prisma.InputJsonValue
}

/** Append an immutable timeline event. Called by every service on create/update/transition
 * (pass the transaction client to keep it atomic with the mutation). */
export async function recordEvent(db: Db, e: TimelineInput): Promise<void> {
  await db.timelineEvent.create({
    data: {
      productId: e.productId,
      entityType: e.entityType,
      entityId: e.entityId,
      eventType: e.eventType,
      actorId: e.actorId ?? null,
      metadata: e.metadata ?? undefined,
    },
  })
}
