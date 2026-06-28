import { requireUser } from '@/lib/session'
import { fail } from '@/server/http'
import { getFileForDownload } from '@/server/services/files'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const user = await requireUser()
    const { file, body } = await getFileForDownload(user.id, id)
    return new Response(new Uint8Array(body), {
      headers: {
        'Content-Type': file.mimeType,
        'Content-Disposition': `inline; filename="${encodeURIComponent(file.fileName)}"`,
      },
    })
  } catch (e) {
    return fail(e)
  }
}
