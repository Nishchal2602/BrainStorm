import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { createProduct } from '@/server/services/products'
import { createFeature } from '@/server/services/features'
import { uploadPrd } from '@/server/services/prds'
import { createReviewRun } from '@/server/services/reviewRuns'
import { ReviewOrchestrator } from '@/server/reviewOrchestrator'
import { persistCompetitorLandscape, persistCustomerEvidence } from '@/server/persistence'
import type { LlmPort } from '@/lib/agents/llm'
import type { CompetitorPayload, CustomerVoicePayload } from '@/lib/agents/types'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`)
}

// Fake LLM: returns just enough per call for the NEW 5-call pipeline to reach a
// Completed run (labels: analyze · pm_review_agent · customer_voice_validate ·
// competitor_discover_reason · synthesis). searchQueries stays empty so the CV
// stage never touches the network (grounded fallback runs through this fake too).
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
          goals: ['Reduce context re-supply'],
          keyRequirements: ['Ingest company docs'],
          constraints: ['SOC2'],
          workflowSummary: 'PM asks; assistant answers with org context.',
          differentiators: ['org-context awareness'],
          architectureSummary: 'RAG over internal knowledge.',
          successMetrics: ['Weekly active PMs'],
          confidence: 0.8,
          rationale: 'clear',
        } as T,
      }
    }
    // Merged Customer Voice call: claims + judgments in ONE response.
    if (label === 'customer_voice_validate') {
      return {
        data: {
          hypotheses: [
            { id: 'h1', statement: 'PMs re-supply company context to AI every session', category: 'problem', confidence: 0.8 },
          ],
          judgments: [],
        } as T,
      }
    }
    // synthesis (recommendation engine)
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
    // Staff-PM readiness reviewer (XML, document-internal — no web search).
    if (req.label === 'pm_review_agent') {
      return {
        text: `<review>
  <strengths><item>Problem statement is clear</item></strengths>
  <critical>
    <issue>
      <title>Undefined success metric</title>
      <where>Goals</where>
      <why>No measurable target is stated</why>
      <impact>Engineering cannot verify completion</impact>
      <fix>Add a numeric success metric</fix>
      <confidence>High</confidence>
    </issue>
  </critical>
  <medium>
    <issue>
      <title>Data integration effort unscoped</title>
      <why>Sources to ingest are not listed</why>
      <fix>Enumerate the systems to integrate</fix>
      <confidence>Medium</confidence>
    </issue>
  </medium>
  <minor></minor>
  <missing>
    <requirements><item>Access-control rules for retrieved context</item></requirements>
    <userFlows></userFlows>
    <edgeCases></edgeCases>
    <acceptanceCriteria></acceptanceCriteria>
    <nonFunctional><item>Latency budget for answers</item></nonFunctional>
  </missing>
  <questions>
    <product><item>Which PM segment first?</item></product>
    <engineering></engineering>
  </questions>
  <score>
    <criticalIssues>1</criticalIssues>
    <mediumIssues>1</mediumIssues>
    <minorIssues>0</minorIssues>
    <readiness>58</readiness>
    <decision>Build with Changes</decision>
    <confidence>High</confidence>
    <rationale>Clear problem, but success measurement and integration scope are missing.</rationale>
  </score>
</review>`,
        sources: [],
      }
    }
    // competitor_discover_reason + CV grounded fallback: zero-competitor / no-docs path.
    return { text: 'NO COMPETITORS FOUND', sources: [] }
  },
}

async function main() {
  const stamp = Date.now()
  const user = await prisma.user.create({
    data: { email: `review+${stamp}@example.com`, passwordHash: await bcrypt.hash('password123', 10), name: 'Rev' },
  })
  const product = await createProduct(user.id, { name: `Review Demo ${stamp}` })
  const feature = await createFeature(user.id, product.id, { name: 'Context awareness' })
  const prd = await uploadPrd(user.id, feature.id, {
    fileName: 'prd.md',
    mimeType: 'text/markdown',
    body: Buffer.from('# Context-aware Enterprise AI\nWe want AI that understands company context.'),
    title: 'PRD v1',
  })
  const run = await createReviewRun(user.id, product.id, { featureId: feature.id, prdId: prd.id })
  assert(run.status === 'Pending', 'run starts Pending')

  // Part A — orchestrate with the fake LLM (awaited).
  await new ReviewOrchestrator({ llm: fakeLlm }).runReview(run.id, user.id)

  const done = await prisma.reviewRun.findUniqueOrThrow({ where: { id: run.id } })
  assert(done.status === 'Completed', `run Completed (was ${done.status})`)
  assert(done.recommendation === 'BuildWithChanges', `recommendation persisted (${done.recommendation})`)
  assert(done.sharedAnalysis != null, 'sharedAnalysis persisted on run')
  const ag = done.agentStatus as Record<string, string>
  assert(
    ['sharedAnalysis', 'pmReview', 'customerVoice', 'competitor', 'recommendation'].every((k) => ag[k] === 'completed'),
    `all agentStatus completed (${JSON.stringify(ag)})`,
  )
  const pm = await prisma.pMReview.findUnique({ where: { reviewRunId: run.id } })
  assert(pm && (pm.risks as string[]).length > 0, 'PMReview persisted with risks')
  const decision = await prisma.decision.findFirst({ where: { reviewRunId: run.id } })
  assert(decision?.status === 'Proposed', 'Decision (Proposed) created from recommendation')
  const events = await prisma.timelineEvent.findMany({ where: { productId: product.id } })
  const types = events.map((e) => e.eventType)
  for (const want of ['Review Started', 'Recommendation Created', 'Review Completed']) {
    assert(types.includes(want), `timeline has "${want}"`)
  }
  console.log('• Part A (orchestration → Completed):', types.filter((t) => t.startsWith('Review') || t.startsWith('Recommendation')).join(', '))

  // Part B — the two complex mappers with canned payloads (deterministic persistence proof).
  const run2 = await createReviewRun(user.id, product.id, { featureId: feature.id, prdId: prd.id })
  const cvPayload = {
    hypotheses: [
      {
        statement: 'PMs re-supply company context to AI',
        verdict: 'supported',
        confidence: 80,
        supportingCount: 3,
        contradictingCount: 1,
        supporting: [{ quote: 'I paste context every time', url: 'https://reddit.com/x', subreddit: 'productmanagement' }],
        contradicting: [],
      },
    ],
    distinctSubreddits: ['productmanagement'],
  } as unknown as CustomerVoicePayload
  const compPayload = {
    landscape: {
      competitors: [
        { name: 'Glean', url: 'https://glean.com', category: 'Enterprise Search', positioning: 'Search', confidence: 85, capabilities: [{ name: 'Enterprise Search', evidence: { url: 'https://glean.com', quote: 'search' } }], strengths: ['retrieval'], weaknesses: ['reasoning'] },
      ],
    },
    differentiationScore: 65,
  } as unknown as CompetitorPayload

  await prisma.$transaction(async (tx) => {
    await persistCustomerEvidence(tx, run2.id, cvPayload, [{ title: 'Context pain', detail: 'real', kind: 'support' }])
    await persistCompetitorLandscape(tx, run2.id, product.id, compPayload, [{ title: 'Glean strong', detail: '', kind: 'risk' }])
  })
  const ce = await prisma.customerEvidence.findMany({ where: { reviewRunId: run2.id } })
  assert(ce.length === 1 && ce[0].verdict === 'Supported', 'CustomerEvidence persisted (Supported)')
  const snaps = await prisma.competitorSnapshot.findMany({ where: { reviewRunId: run2.id }, include: { competitor: true } })
  assert(snaps.length === 1 && snaps[0].competitor.name === 'Glean', 'Competitor + Snapshot persisted (Glean)')
  const findings = await prisma.finding.findMany({ where: { reviewRunId: run2.id } })
  assert(findings.length >= 2, 'Findings persisted')
  console.log('• Part B (persistence mappers): CustomerEvidence + Competitor/Snapshot + Findings ✓')

  console.log('\nREVIEW E2E OK ✅')
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('\nREVIEW E2E FAILED ❌\n', e)
    await prisma.$disconnect()
    process.exit(1)
  })
