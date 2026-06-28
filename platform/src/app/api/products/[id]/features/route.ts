import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/session'
import { fail, readJson } from '@/server/http'
import { FeatureCreate } from '@/lib/validation'
import { createFeature, listFeatures } from '@/server/services/features'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const user = await requireUser()
    return NextResponse.json(await listFeatures(user.id, id))
  } catch (e) {
    return fail(e)
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const user = await requireUser()
    const input = FeatureCreate.parse(await readJson(req))
    return NextResponse.json(await createFeature(user.id, id, input), { status: 201 })
  } catch (e) {
    return fail(e)
  }
}
