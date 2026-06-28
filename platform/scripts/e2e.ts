import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { createProduct, getProduct } from '@/server/services/products'
import { createFeature, updateFeature } from '@/server/services/features'
import { uploadPrd } from '@/server/services/prds'
import { createReviewRun } from '@/server/services/reviewRuns'
import { createDecision, transitionDecision } from '@/server/services/decisions'
import { HttpError } from '@/server/errors'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`)
}

async function main() {
  const stamp = Date.now()
  const hash = await bcrypt.hash('password123', 10)
  const user = await prisma.user.create({
    data: { email: `e2e+${stamp}@example.com`, passwordHash: hash, name: 'E2E' },
  })
  const other = await prisma.user.create({
    data: { email: `other+${stamp}@example.com`, passwordHash: hash },
  })

  const product = await createProduct(user.id, { name: `E2E Product ${stamp}`, summary: 'demo' })
  console.log('• product created:', product.name, `(slug=${product.slug})`)

  let denied = false
  try {
    await getProduct(other.id, product.id)
  } catch (e) {
    denied = e instanceof HttpError && e.status === 403
  }
  assert(denied, 'non-member must be denied (403)')
  console.log('• access control: non-member denied ✓')

  const feature = await createFeature(user.id, product.id, { name: 'E2E Feature' })
  await updateFeature(user.id, feature.id, { stage: 'Discovery' })
  console.log('• feature stage Ideation → Discovery ✓')

  let illegal = false
  try {
    await updateFeature(user.id, feature.id, { stage: 'Released' })
  } catch (e) {
    illegal = e instanceof HttpError && e.status === 422
  }
  assert(illegal, 'illegal stage jump must be rejected (422)')
  console.log('• state machine: illegal stage jump rejected ✓')

  const prd = await uploadPrd(user.id, feature.id, {
    fileName: 'spec.md',
    mimeType: 'text/markdown',
    body: Buffer.from('# Spec\nHello from e2e'),
    title: 'Spec v1',
  })
  assert(prd.version === 1 && prd.status === 'Submitted', 'PRD v1 Submitted')
  console.log('• PRD uploaded (file stored), v' + prd.version, prd.status, '✓')

  const run = await createReviewRun(user.id, product.id, { featureId: feature.id, prdId: prd.id })
  assert(run.status === 'Pending', 'review run starts Pending')
  console.log('• review run created (execution context):', run.status, '✓')

  const decision = await createDecision(user.id, product.id, {
    title: 'Build it',
    decision: 'Proceed to build',
    reviewRunId: run.id,
  })
  assert(decision.status === 'Proposed', 'decision starts Proposed')
  const approved = await transitionDecision(user.id, decision.id, 'Approved')
  assert(approved.status === 'Approved' && approved.approvedBy === user.id, 'decision approved')
  console.log('• decision Proposed → Approved ✓')

  let badDecision = false
  try {
    await transitionDecision(user.id, decision.id, 'Proposed')
  } catch (e) {
    badDecision = e instanceof HttpError && e.status === 422
  }
  assert(badDecision, 'illegal decision transition rejected (422)')
  console.log('• state machine: illegal decision transition rejected ✓')

  const events = await prisma.timelineEvent.findMany({
    where: { productId: product.id },
    orderBy: { createdAt: 'asc' },
  })
  console.log('• timeline events:', events.map((e) => e.eventType).join(', '))
  assert(events.length >= 6, 'expected ≥6 timeline events from the flow')

  console.log('\nE2E OK ✅')
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('\nE2E FAILED ❌\n', e)
    await prisma.$disconnect()
    process.exit(1)
  })
