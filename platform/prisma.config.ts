import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

// Prisma 7: connection URL lives here (for Migrate/CLI), not in schema.prisma.
// The runtime PrismaClient gets a driver adapter (see src/lib/db.ts).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
})
