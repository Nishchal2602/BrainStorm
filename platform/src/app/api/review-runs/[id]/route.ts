import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/session'
import { fail, readJson } from '@/server/http'
import { ReviewRunUpdate } from '@/lib/validation'
import { getReviewRun, updateReviewRunStatus } from '@/server/services/reviewRuns'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const user = await requireUser()
    return NextResponse.json(await getReviewRun(user.id, id))
  } catch (e) {
    return fail(e)
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const user = await requireUser()
    const { status } = ReviewRunUpdate.parse(await readJson(req))
    return NextResponse.json(await updateReviewRunStatus(user.id, id, status))
  } catch (e) {
    return fail(e)
  }
}
