import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { HttpError } from './errors'

/** Map a thrown error to a JSON response. Use in every route handler's catch. */
export function fail(e: unknown): NextResponse {
  if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status })
  if (e instanceof ZodError) {
    return NextResponse.json({ error: e.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
  }
  console.error('[api] unhandled error', e)
  return NextResponse.json({ error: 'Internal error' }, { status: 500 })
}

/** Parse a JSON body or throw a 400. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    throw new HttpError(400, 'Expected a JSON body')
  }
}
