import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/session'
import { fail, readJson } from '@/server/http'
import { FeatureUpdate } from '@/lib/validation'
import { getFeature, updateFeature } from '@/server/services/features'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const user = await requireUser()
    return NextResponse.json(await getFeature(user.id, id))
  } catch (e) {
    return fail(e)
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const user = await requireUser()
    const input = FeatureUpdate.parse(await readJson(req))
    return NextResponse.json(await updateFeature(user.id, id, input))
  } catch (e) {
    return fail(e)
  }
}
