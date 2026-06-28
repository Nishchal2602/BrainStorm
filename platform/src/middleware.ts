import NextAuth from 'next-auth'
import { authConfig } from '@/lib/auth.config'

// Edge middleware uses the DB-free config; the `authorized` callback gates /products/*.
export default NextAuth(authConfig).auth

export const config = {
  matcher: ['/products/:path*'],
}
