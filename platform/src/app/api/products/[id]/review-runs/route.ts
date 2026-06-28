import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/session'
import { fail, readJson } from '@/server/http'
import { ReviewRunCreate } from '@/lib/validation'
import { createReviewRun } from '@/server/services/reviewRuns'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const user = await requireUser()
    const input = ReviewRunCreate.parse(await readJson(req))
    return NextResponse.json(await createReviewRun(user.id, id, input), { status: 201 })
  } catch (e) {
    return fail(e)
  }
}
