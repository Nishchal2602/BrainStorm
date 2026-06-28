import { prisma } from '@/lib/db'
import { requireMember, requireRole } from '@/server/access'
import { conflict, notFound } from '@/server/errors'
import { recordEvent } from '@/server/timeline'
import type { MemberRole } from '@/generated/prisma'

export async function listMembers(userId: string, productId: string) {
  await requireMember(productId, userId)
  return prisma.productMember.findMany({ where: { productId }, orderBy: { joinedAt: 'asc' } })
}

/** Add an existing user (by email) to the product. Requires Admin+. */
export async function addMember(
  userId: string,
  productId: string,
  input: { email: string; role?: MemberRole },
) {
  await requireRole(productId, userId, 'Admin')
  const target = await prisma.user.findUnique({ where: { email: input.email.toLowerCase().trim() } })
  if (!target) throw notFound('No user with that email')
  const existing = await prisma.productMember.findUnique({
    where: { productId_userId: { productId, userId: target.id } },
  })
  if (existing) throw conflict('That user is already a member')

  return prisma.$transaction(async (tx) => {
    const member = await tx.productMember.create({
      data: { productId, userId: target.id, role: input.role ?? 'Editor', status: 'Active', invitedBy: userId },
    })
    await recordEvent(tx, {
      productId,
      entityType: 'Product',
      entityId: productId,
      eventType: 'member.added',
      actorId: userId,
      metadata: { email: input.email, role: member.role },
    })
    return member
  })
}
