import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/session'
import { fail, readJson } from '@/server/http'
import { ProductUpdate } from '@/lib/validation'
import { archiveProduct, getProduct, updateProduct } from '@/server/services/products'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const user = await requireUser()
    return NextResponse.json(await getProduct(user.id, id))
  } catch (e) {
    return fail(e)
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const user = await requireUser()
    const input = ProductUpdate.parse(await readJson(req))
    return NextResponse.json(await updateProduct(user.id, id, input))
  } catch (e) {
    return fail(e)
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const user = await requireUser()
    return NextResponse.json(await archiveProduct(user.id, id))
  } catch (e) {
    return fail(e)
  }
}
