import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/session'
import { fail } from '@/server/http'
import { badRequest } from '@/server/errors'
import { listPrds, uploadPrd } from '@/server/services/prds'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const user = await requireUser()
    return NextResponse.json(await listPrds(user.id, id))
  } catch (e) {
    return fail(e)
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const user = await requireUser()
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) throw badRequest('Expected a "file" upload')
    const title = form.get('title')
    const prd = await uploadPrd(user.id, id, {
      fileName: file.name || 'prd',
      mimeType: file.type || 'application/octet-stream',
      body: Buffer.from(await file.arrayBuffer()),
      title: typeof title === 'string' ? title : undefined,
    })
    return NextResponse.json(prd, { status: 201 })
  } catch (e) {
    return fail(e)
  }
}
