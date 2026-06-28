import { NextResponse, after } from 'next/server'
import { requireUser } from '@/lib/session'
import { fail, readJson } from '@/server/http'
import { ReviewRunCreate } from '@/lib/validation'
import { createReviewRun } from '@/server/services/reviewRuns'
import { ReviewOrchestrator } from '@/server/reviewOrchestrator'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const user = await requireUser()
    const input = ReviewRunCreate.parse(await readJson(req))
    const run = await createReviewRun(user.id, id, input)
    // Execute the pipeline after responding (async in-process; client polls run status).
    after(() => new ReviewOrchestrator().runReview(run.id, user.id))
    return NextResponse.json(run, { status: 201 })
  } catch (e) {
    return fail(e)
  }
}
