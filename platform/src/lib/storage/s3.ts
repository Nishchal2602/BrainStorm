import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { StorageProvider } from './index'

/** S3-compatible storage (AWS S3 / Cloudflare R2). storagePath = the object key. */
export class S3Storage implements StorageProvider {
  private bucket = process.env.S3_BUCKET ?? ''
  private client = new S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: !!process.env.S3_ENDPOINT,
    credentials:
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
          }
        : undefined,
  })

  async put(key: string, body: Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    )
    return key
  }

  async get(storagePath: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: storagePath }),
    )
    const bytes = await res.Body!.transformToByteArray()
    return Buffer.from(bytes)
  }
}
