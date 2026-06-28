import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { StorageProvider } from './index'

/** Dev storage: writes under STORAGE_LOCAL_DIR (default ./uploads). storagePath = the key. */
export class LocalStorage implements StorageProvider {
  private root = resolve(process.cwd(), process.env.STORAGE_LOCAL_DIR || './uploads')

  async put(key: string, body: Buffer): Promise<string> {
    const full = join(this.root, key)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, body)
    return key
  }

  async get(storagePath: string): Promise<Buffer> {
    return readFile(join(this.root, storagePath))
  }
}
