import { prisma } from '@/lib/db'
import { requireMember, requireRole } from '@/server/access'
import { notFound } from '@/server/errors'
import { recordEvent } from '@/server/timeline'
import { buildStorageKey, getStorage } from '@/lib/storage'

export async function listPrds(userId: string, featureId: string) {
  const feature = await prisma.feature.findUnique({ where: { id: featureId } })
  if (!feature) throw notFound('Feature not found')
  await requireMember(feature.productId, userId)
  return prisma.pRD.findMany({ where: { featureId }, orderBy: { version: 'desc' } })
}

export async function getPrd(userId: string, prdId: string) {
  const prd = await prisma.pRD.findUnique({ where: { id: prdId } })
  if (!prd) throw notFound('PRD not found')
  await requireMember(prd.productId, userId)
  return prd
}

export interface PrdUpload {
  fileName: string
  mimeType: string
  body: Buffer
  title?: string
}

/** Upload a PRD: store the file, create a versioned PRD record (Submitted), set it as
 * the feature's current PRD, and record a timeline event. */
export async function uploadPrd(userId: string, featureId: string, upload: PrdUpload) {
  const feature = await prisma.feature.findUnique({ where: { id: featureId } })
  if (!feature) throw notFound('Feature not found')
  await requireRole(feature.productId, userId, 'Editor')

  const key = buildStorageKey(feature.productId, upload.fileName)
  const storagePath = await getStorage().put(key, upload.body, upload.mimeType)

  const last = await prisma.pRD.findFirst({ where: { featureId }, orderBy: { version: 'desc' } })
  const version = (last?.version ?? 0) + 1

  return prisma.$transaction(async (tx) => {
    const file = await tx.file.create({
      data: {
        productId: feature.productId,
        featureId,
        uploadedBy: userId,
        fileName: upload.fileName,
        mimeType: upload.mimeType,
        storagePath,
      },
    })
    const prd = await tx.pRD.create({
      data: {
        featureId,
        productId: feature.productId,
        version,
        title: upload.title || upload.fileName,
        authorId: userId,
        source: 'Upload',
        documentFileId: file.id,
        status: 'Submitted',
      },
    })
    await tx.feature.update({ where: { id: featureId }, data: { currentPrdId: prd.id } })
    await recordEvent(tx, {
      productId: feature.productId,
      entityType: 'PRD',
      entityId: prd.id,
      eventType: 'prd.uploaded',
      actorId: userId,
      metadata: { version, fileName: upload.fileName },
    })
    return prd
  })
}
