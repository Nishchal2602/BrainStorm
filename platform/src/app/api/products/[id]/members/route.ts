import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/session'
import { fail, readJson } from '@/server/http'
import { MemberAdd } from '@/lib/validation'
import { addMember, listMembers } from '@/server/services/members'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const user = await requireUser()
    return NextResponse.json(await listMembers(user.id, id))
  } catch (e) {
    return fail(e)
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const user = await requireUser()
    const input = MemberAdd.parse(await readJson(req))
    return NextResponse.json(await addMember(user.id, id, input), { status: 201 })
  } catch (e) {
    return fail(e)
  }
}
