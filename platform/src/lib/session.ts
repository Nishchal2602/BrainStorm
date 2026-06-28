import { auth } from '@/lib/auth'
import { unauthorized } from '@/server/errors'

export interface SessionUser {
  id: string
  email?: string | null
  name?: string | null
}

/** The current user, or null. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth()
  return session?.user?.id ? (session.user as SessionUser) : null
}

/** The current user, or throw 401. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) throw unauthorized()
  return user
}
