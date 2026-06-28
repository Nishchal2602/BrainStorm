import { LocalStorage } from './local'
import { S3Storage } from './s3'

/** A pluggable blob store. `storagePath` is what we persist on the File record. */
export interface StorageProvider {
  /** Store bytes under `key`; returns the storagePath to persist. */
  put(key: string, body: Buffer, contentType: string): Promise<string>
  /** Read bytes back for download. */
  get(storagePath: string): Promise<Buffer>
}

let cached: StorageProvider | null = null

export function getStorage(): StorageProvider {
  if (cached) return cached
  cached = process.env.STORAGE_DRIVER === 's3' ? new S3Storage() : new LocalStorage()
  return cached
}

/** Build a stable, collision-free storage key for an upload. */
export function buildStorageKey(productId: string, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'file'
  return `${productId}/${crypto.randomUUID()}-${safe}`
}
