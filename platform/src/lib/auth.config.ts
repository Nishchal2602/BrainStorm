import type { NextAuthConfig } from 'next-auth'

/** Edge-safe config (no DB). Shared by the middleware and the full Node config in auth.ts. */
export const authConfig = {
  session: { strategy: 'jwt' },
  pages: { signIn: '/signin' },
  providers: [], // the Credentials provider (needs the DB) is added in auth.ts
  callbacks: {
    authorized({ auth, request }) {
      const loggedIn = !!auth?.user
      const isProtected = request.nextUrl.pathname.startsWith('/products')
      if (isProtected && !loggedIn) return false // → redirect to signIn
      return true
    },
    jwt({ token, user }) {
      if (user) token.id = (user as { id: string }).id
      return token
    },
    session({ session, token }) {
      if (session.user && token.id) session.user.id = token.id as string
      return session
    },
  },
} satisfies NextAuthConfig
