import { NextResponse, after } from 'next/server'
import { requireUser } from '@/lib/session'
import { fail, readJson } from '@/server/http'
import { ReviewRunCreate } from '@/lib/validation'
import { createReviewRun } from '@/server/services/reviewRuns'
import { ReviewOrchestrator } from '@/server/reviewOrchestrator'
import { LemmaReviewRunner } from '@/server/lemma/lemmaReviewRunner'
import { lemmaConfig } from '@/server/lemma/config'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const user = await requireUser()
    const input = ReviewRunCreate.parse(await readJson(req))
    const run = await createReviewRun(user.id, id, input)
    // Pick the runner: real Lemma workflow when enabled + configured, else the existing
    // in-process orchestrator. The Lemma runner itself falls back to the orchestrator if
    // the stack is unreachable at start — so a broken/absent Lemma can never block reviews.
    const runner = lemmaConfig.configured ? new LemmaReviewRunner() : new ReviewOrchestrator()
    // Execute the pipeline after responding (async in-process; client polls run status).
    after(() => runner.runReview(run.id, user.id))
    return NextResponse.json(run, { status: 201 })
  } catch (e) {
    return fail(e)
  }
}
