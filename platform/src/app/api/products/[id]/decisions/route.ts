import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/session'
import { fail, readJson } from '@/server/http'
import { DecisionCreate } from '@/lib/validation'
import { createDecision, listDecisions } from '@/server/services/decisions'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const user = await requireUser()
    return NextResponse.json(await listDecisions(user.id, id))
  } catch (e) {
    return fail(e)
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const user = await requireUser()
    const input = DecisionCreate.parse(await readJson(req))
    return NextResponse.json(await createDecision(user.id, id, input), { status: 201 })
  } catch (e) {
    return fail(e)
  }
}
