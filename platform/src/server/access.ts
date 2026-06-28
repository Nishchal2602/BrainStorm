import { prisma } from '@/lib/db'
import type { MemberRole, ProductMember } from '@/generated/prisma'
import { forbidden } from './errors'

const ROLE_RANK: Record<MemberRole, number> = { Viewer: 0, Editor: 1, Admin: 2, Owner: 3 }

export function getMembership(productId: string, userId: string): Promise<ProductMember | null> {
  return prisma.productMember.findUnique({ where: { productId_userId: { productId, userId } } })
}

/** Ensure the user is an active member of the product (else 403). */
export async function requireMember(productId: string, userId: string): Promise<ProductMember> {
  const m = await getMembership(productId, userId)
  if (!m || m.status !== 'Active') throw forbidden('You do not have access to this product')
  return m
}

/** Ensure the user is an active member with at least `min` role. */
export async function requireRole(
  productId: string,
  userId: string,
  min: MemberRole,
): Promise<ProductMember> {
  const m = await requireMember(productId, userId)
  if (ROLE_RANK[m.role] < ROLE_RANK[min]) throw forbidden(`Requires ${min} role or higher`)
  return m
}
