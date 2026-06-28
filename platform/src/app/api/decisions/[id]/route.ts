import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/session'
import { fail, readJson } from '@/server/http'
import { DecisionTransition } from '@/lib/validation'
import { transitionDecision } from '@/server/services/decisions'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const user = await requireUser()
    const { status } = DecisionTransition.parse(await readJson(req))
    return NextResponse.json(await transitionDecision(user.id, id, status))
  } catch (e) {
    return fail(e)
  }
}
