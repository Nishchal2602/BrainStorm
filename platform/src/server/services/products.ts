import { prisma } from '@/lib/db'
import { requireMember, requireRole } from '@/server/access'
import { notFound } from '@/server/errors'
import { recordEvent } from '@/server/timeline'
import { assertTransition, PRODUCT_STATUS_FLOW } from '@/server/stateMachines'
import type { ProductCreateInput, ProductUpdateInput } from '@/lib/validation'

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'product'
  )
}

export function listProducts(userId: string) {
  return prisma.product.findMany({
    where: { members: { some: { userId, status: 'Active' } } },
    orderBy: { updatedAt: 'desc' },
  })
}

export async function createProduct(userId: string, input: ProductCreateInput) {
  const base = slugify(input.name)
  let slug = base
  let n = 1
  while (await prisma.product.findUnique({ where: { slug } })) slug = `${base}-${++n}`

  return prisma.$transaction(async (tx) => {
    const product = await tx.product.create({ data: { ...input, slug, ownerId: userId } })
    await tx.productMember.create({
      data: { productId: product.id, userId, role: 'Owner', status: 'Active' },
    })
    await recordEvent(tx, {
      productId: product.id,
      entityType: 'Product',
      entityId: product.id,
      eventType: 'product.created',
      actorId: userId,
      metadata: { name: product.name },
    })
    return product
  })
}

export async function getProduct(userId: string, id: string) {
  await requireMember(id, userId)
  const product = await prisma.product.findUnique({ where: { id } })
  if (!product) throw notFound('Product not found')
  return product
}

export async function updateProduct(userId: string, id: string, input: ProductUpdateInput) {
  await requireRole(id, userId, 'Editor')
  const existing = await prisma.product.findUnique({ where: { id } })
  if (!existing) throw notFound('Product not found')
  if (input.status && input.status !== existing.status) {
    assertTransition(PRODUCT_STATUS_FLOW, existing.status, input.status, 'product status')
  }
  const data: Record<string, unknown> = { ...input }
  if (input.status === 'Archived') data.archivedAt = new Date()

  return prisma.$transaction(async (tx) => {
    const product = await tx.product.update({ where: { id }, data })
    await recordEvent(tx, {
      productId: id,
      entityType: 'Product',
      entityId: id,
      eventType: input.status && input.status !== existing.status ? 'product.status_changed' : 'product.updated',
      actorId: userId,
    })
    return product
  })
}

export function archiveProduct(userId: string, id: string) {
  return updateProduct(userId, id, { status: 'Archived' })
}
