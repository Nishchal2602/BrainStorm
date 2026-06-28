import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/session'
import { fail } from '@/server/http'
import { getPrd } from '@/server/services/prds'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const user = await requireUser()
    return NextResponse.json(await getPrd(user.id, id))
  } catch (e) {
    return fail(e)
  }
}
