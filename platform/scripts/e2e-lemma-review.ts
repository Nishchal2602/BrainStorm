import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { createProduct } from '@/server/services/products'
import { createFeature } from '@/server/services/features'
import { uploadPrd } from '@/server/services/prds'
import { createReviewRun } from '@/server/services/reviewRuns'
import { LemmaReviewRunner } from '@/server/lemma/lemmaReviewRunner'
import { FakeLemmaClient } from '@/server/lemma/fakeClient'
import type { LlmPort } from '@/lib/agents/llm'

// Verifies the Lemma "shell" path WITHOUT a Lemma stack: a FakeLemmaClient simulates
// the 5 FORM-gated workflow (WAITING→submit→…→COMPLETED) while the existing agents run
// via a fake LlmPort. Asserts the SAME persisted outputs + timeline as the in-process
// path, plus agentStatus.__engine==='lemma'. Also checks the failure path.

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`)
}

const NODE_ORDER = ['sharedAnalysis', 'pmReview', 'customerVoice', 'competitor', 'recommendation']

// Same fake brain as scripts/e2e-review.ts — just enough for the pipeline to reach Completed.
const fakeLlm: LlmPort = {
  async generateStructured<T>(req: { label?: string }): Promise<{ data: T }> {
    const label = req.label
    if (label === 'analyze') {
      return {
        data: {
          industry: 'SaaS',
          productCategory: 'Enterprise AI Assistant',
          featureCategory: 'Context awareness',
          regulatorySensitivity: 'low',
          isNewProduct: true,
          coreProblem: 'AI lacks company context',
          persona: 'Product Manager',
          synonyms: [],
          searchQueries: [],
          solutionCategory: 'Enterprise AI Assistant',
          keyCapabilities: ['RAG'],
          confidence: 0.8,
          rationale: 'clear',
        } as T,
      }
    }
    if (label === 'customer_voice_hypotheses') return { data: { hypotheses: [] } as T }
    if (label === 'customer_voice_verify') return { data: { judgments: [] } as T }
    return {
      data: {
        executiveSummary: 'Differentiated; proceed with focus on organizational reasoning.',
        recommendation: 'Build with Changes',
        confidence: 0.72,
        supportingEvidence: ['Clear problem'],
        contradictingEvidence: [],
        risks: ['Crowded market'],
        openQuestions: ['Which segment first?'],
        suggestedExperiments: [],
        missingRequirements: [],
        finalVerdict: 'Build with Changes',
        decision: { recommendation: 'build_with_changes', confidence: 0.72, rationale: ['Differentiated positioning'] },
      } as T,
    }
  },
  async generateText(req: { label?: string }) {
    if (req.label === 'pm_review') {
      return {
        text: '## Risks\n- Adoption risk\n## Critical Unknowns\n- Undefined success metric\n## Implementation Considerations\n- Data integration effort\n## If I Were the PM\n1. Validate the core problem with 5 PMs',
        sources: [],
      }
    }
    return { text: 'NO COMPETITORS FOUND', sources: [] }
  },
}

async function setup(label: string) {
  const stamp = Date.now()
  const user = await prisma.user.create({
    data: { email: `lemma+${label}-${stamp}@example.com`, passwordHash: await bcrypt.hash('password123', 10), name: 'Lem' },
  })
  const product = await createProduct(user.id, { name: `Lemma Demo ${label} ${stamp}` })
  const feature = await createFeature(user.id, product.id, { name: 'Context awareness' })
  const prd = await uploadPrd(user.id, feature.id, {
    fileName: 'prd.md',
    mimeType: 'text/markdown',
    body: Buffer.from('# Context-aware Enterprise AI\nWe want AI that understands company context.'),
    title: 'PRD v1',
  })
  const run = await createReviewRun(user.id, product.id, { featureId: feature.id, prdId: prd.id })
  return { user, product, feature, prd, run }
}

async function main() {
  // Part A — happy path: FakeLemmaClient drives all 5 nodes to COMPLETED.
  {
    const { user, product, run } = await setup('ok')
    const lemma = new FakeLemmaClient(NODE_ORDER)
    await new LemmaReviewRunner({ llm: fakeLlm, lemma }).runReview(run.id, user.id)

    const done = await prisma.reviewRun.findUniqueOrThrow({ where: { id: run.id } })
    assert(done.status === 'Completed', `run Completed (was ${done.status})`)
    assert(done.recommendation === 'BuildWithChanges', `recommendation persisted (${done.recommendation})`)
    assert(done.sharedAnalysis != null, 'sharedAnalysis persisted on run')
    const ag = done.agentStatus as Record<string, string>
    assert(ag.__engine === 'lemma', `agentStatus.__engine === lemma (${ag.__engine})`)
    assert(typeof ag.__lemmaRunId === 'string' && ag.__lemmaRunId.length > 0, 'lemma run id stashed')
    assert(
      NODE_ORDER.every((k) => ag[k] === 'completed'),
      `all stages completed (${JSON.stringify(ag)})`,
    )
    const pm = await prisma.pMReview.findUnique({ where: { reviewRunId: run.id } })
    assert(pm && (pm.risks as string[]).length > 0, 'PMReview persisted with risks')
    const decision = await prisma.decision.findFirst({ where: { reviewRunId: run.id } })
    assert(decision?.status === 'Proposed', 'Decision (Proposed) created')
    const events = (await prisma.timelineEvent.findMany({ where: { productId: product.id } })).map((e) => e.eventType)
    for (const want of ['Review Started', 'PM Review Completed', 'Recommendation Created', 'Review Completed']) {
      assert(events.includes(want), `timeline has "${want}" (got ${events.join(', ')})`)
    }
    console.log('• Part A (Lemma shell → Completed):', events.filter((t) => /Review|Recommendation|Completed/.test(t)).join(', '))
  }

  // Part B — failure path: force the workflow to FAIL at the competitor node.
  {
    const { user, product, run } = await setup('fail')
    const lemma = new FakeLemmaClient(NODE_ORDER, 'competitor')
    await new LemmaReviewRunner({ llm: fakeLlm, lemma }).runReview(run.id, user.id)

    const done = await prisma.reviewRun.findUniqueOrThrow({ where: { id: run.id } })
    assert(done.status === 'Failed', `run Failed (was ${done.status})`)
    // Work completed before the failure is preserved (PM Review ran before competitor).
    const pm = await prisma.pMReview.findUnique({ where: { reviewRunId: run.id } })
    assert(pm != null, 'completed work preserved (PMReview persisted before failure)')
    const events = (await prisma.timelineEvent.findMany({ where: { productId: product.id } })).map((e) => e.eventType)
    assert(events.includes('Review Failed'), `timeline has "Review Failed" (got ${events.join(', ')})`)
    console.log('• Part B (forced Lemma FAIL at competitor): run Failed, prior work preserved ✓')
  }

  console.log('\nLEMMA REVIEW E2E OK ✅')
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('\nLEMMA REVIEW E2E FAILED ❌\n', e)
    await prisma.$disconnect()
    process.exit(1)
  })
