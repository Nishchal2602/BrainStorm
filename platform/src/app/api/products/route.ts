import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/session'
import { fail, readJson } from '@/server/http'
import { ProductCreate } from '@/lib/validation'
import { createProduct, listProducts } from '@/server/services/products'

export async function GET() {
  try {
    const user = await requireUser()
    return NextResponse.json(await listProducts(user.id))
  } catch (e) {
    return fail(e)
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser()
    const input = ProductCreate.parse(await readJson(req))
    return NextResponse.json(await createProduct(user.id, input), { status: 201 })
  } catch (e) {
    return fail(e)
  }
}
