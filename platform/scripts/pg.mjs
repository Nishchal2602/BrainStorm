// Local Postgres for development — no Docker required (uses embedded-postgres).
// `node scripts/pg.mjs` starts Postgres on :54329 with a persistent data dir and
// stays in the foreground (Ctrl-C to stop). Matches DATABASE_URL in .env.
import EmbeddedPostgres from 'embedded-postgres'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const databaseDir = join(root, '.pgdata')

const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'pocketpm',
  password: 'pocketpm',
  port: 54329,
  persistent: true,
})

const fresh = !existsSync(databaseDir)
if (fresh) {
  console.log('[pg] initialising data dir…')
  await pg.initialise()
}
await pg.start()
try {
  await pg.createDatabase('pocketpm')
  console.log('[pg] created database "pocketpm"')
} catch {
  // already exists — fine
}
console.log('[pg] ready on postgresql://pocketpm:pocketpm@localhost:54329/pocketpm  (Ctrl-C to stop)')

const stop = async () => {
  console.log('\n[pg] stopping…')
  try {
    await pg.stop()
  } finally {
    process.exit(0)
  }
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
// Keep the process alive so Postgres stays up.
setInterval(() => {}, 1 << 30)
