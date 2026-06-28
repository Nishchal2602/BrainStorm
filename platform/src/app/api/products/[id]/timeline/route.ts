import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/session'
import { requireMember } from '@/server/access'
import { fail } from '@/server/http'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const user = await requireUser()
    await requireMember(id, user.id)
    const events = await prisma.timelineEvent.findMany({
      where: { productId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    return NextResponse.json(events)
  } catch (e) {
    return fail(e)
  }
}
