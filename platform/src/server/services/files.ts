import { prisma } from '@/lib/db'
import { requireMember, requireRole } from '@/server/access'
import { notFound } from '@/server/errors'
import { recordEvent } from '@/server/timeline'
import { buildStorageKey, getStorage } from '@/lib/storage'

export interface FileUpload {
  fileName: string
  mimeType: string
  body: Buffer
  featureId?: string
  reviewRunId?: string
}

export async function uploadFile(userId: string, productId: string, upload: FileUpload) {
  await requireRole(productId, userId, 'Editor')
  const key = buildStorageKey(productId, upload.fileName)
  const storagePath = await getStorage().put(key, upload.body, upload.mimeType)

  return prisma.$transaction(async (tx) => {
    const file = await tx.file.create({
      data: {
        productId,
        featureId: upload.featureId ?? null,
        reviewRunId: upload.reviewRunId ?? null,
        uploadedBy: userId,
        fileName: upload.fileName,
        mimeType: upload.mimeType,
        storagePath,
      },
    })
    await recordEvent(tx, {
      productId,
      entityType: 'File',
      entityId: file.id,
      eventType: 'file.uploaded',
      actorId: userId,
      metadata: { fileName: upload.fileName },
    })
    return file
  })
}

export async function listProductFiles(userId: string, productId: string) {
  await requireMember(productId, userId)
  return prisma.file.findMany({ where: { productId }, orderBy: { createdAt: 'desc' } })
}

export async function getFileForDownload(userId: string, fileId: string) {
  const file = await prisma.file.findUnique({ where: { id: fileId } })
  if (!file) throw notFound('File not found')
  await requireMember(file.productId, userId)
  const body = await getStorage().get(file.storagePath)
  return { file, body }
}
