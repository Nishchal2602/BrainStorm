import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/session'
import { fail } from '@/server/http'
import { badRequest } from '@/server/errors'
import { listProductFiles, uploadFile } from '@/server/services/files'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const user = await requireUser()
    return NextResponse.json(await listProductFiles(user.id, id))
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
    const featureId = form.get('featureId')
    const reviewRunId = form.get('reviewRunId')
    const created = await uploadFile(user.id, id, {
      fileName: file.name || 'file',
      mimeType: file.type || 'application/octet-stream',
      body: Buffer.from(await file.arrayBuffer()),
      featureId: typeof featureId === 'string' && featureId ? featureId : undefined,
      reviewRunId: typeof reviewRunId === 'string' && reviewRunId ? reviewRunId : undefined,
    })
    return NextResponse.json(created, { status: 201 })
  } catch (e) {
    return fail(e)
  }
}
