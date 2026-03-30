import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// All known cookie prefixes — includes legacy 'better-auth' default and
// the current 'nextjs-stream' prefix so users migrating from either are covered.
const COOKIE_PREFIXES = ['better-auth', 'nextjs-stream']

const AUTH_COOKIE_NAMES = COOKIE_PREFIXES.flatMap((prefix) => [
  `${prefix}.session_token`,
  `${prefix}.session_data`,
  `${prefix}.dont_remember`,
  `__Secure-${prefix}.session_token`,
  `__Secure-${prefix}.session_data`,
  `__Secure-${prefix}.dont_remember`,
])

const COOKIE_DOMAIN = process.env.AUTH_COOKIE_DOMAIN?.replace(/^\./, '')

export function proxy(request: NextRequest) {
  const response = NextResponse.next()

  if (COOKIE_DOMAIN) {
    // When AUTH_COOKIE_DOMAIN is set, better-auth sets session cookies with
    // Domain=<COOKIE_DOMAIN>. If a user previously logged in before this was
    // enabled, they have old host-only cookies (no Domain attribute) with the
    // same name. The browser sends both; better-auth reads the old one first,
    // fails the session lookup, then clears the valid domain-scoped cookie —
    // leaving the user stuck in a broken auth loop requiring manual cookie clearing.
    //
    // Fix: emit Set-Cookie clears WITHOUT a Domain attribute. Browsers treat
    // a cookie with Domain=X and one without Domain as distinct cookies, so
    // this only deletes the host-only cookie and leaves the domain-scoped one
    // intact. On the first response after migration, conflicting cookies are
    // swept away automatically without the user needing to do anything.
    for (const name of AUTH_COOKIE_NAMES) {
      if (request.cookies.has(name)) {
        response.headers.append(
          'Set-Cookie',
          `${name}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
        )
      }
    }
  }

  return response
}

export const config = {
  matcher: [
    // Run on all routes except Next.js internals and static assets
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
