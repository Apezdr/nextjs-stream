import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { buildImgproxyTarget } from '@src/lib/imgproxy'

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

// Authenticated API routes that manage their own caching (ETag + no-cache
// revalidation chains, public caption caching, SSE streams). Headers set in
// this proxy are applied to the response BEFORE the route handler runs, and
// a header the proxy already set cannot be overridden by the route handler
// (sendResponse only appends headers that aren't present) — so the no-store
// default below would silently break these routes' caching if they weren't
// skipped. Any new route under /api/authenticated/ that sets its own
// Cache-Control MUST be added here.
const SELF_CACHED_API_PREFIXES = [
  '/api/authenticated/tmdb',
  '/api/authenticated/screensaver',
  '/api/authenticated/captions',
  '/api/authenticated/admin/sync-stream',
  '/api/authenticated/system-status',
  '/api/authenticated/notifications',
  '/api/authenticated/banner',
  '/api/authenticated/horizontal-list',
  '/api/authenticated/sync/pullPlayback',
  '/api/authenticated/watchlist',
]

export function proxy(request: NextRequest) {
  // Optional imgproxy offload: when IMGPROXY_URL is set, hand image
  // optimization to an external imgproxy container instead of the built-in
  // sharp optimizer. A null target (not configured, local /public source,
  // or malformed params) falls through to the built-in optimizer.
  if (request.nextUrl.pathname === '/_next/image') {
    const target = buildImgproxyTarget(request.nextUrl.searchParams)
    if (!target) return NextResponse.next()

    if (target.mode === 'redirect') {
      return NextResponse.redirect(target.url, 307)
    }

    // Rewrite proxies the imgproxy response while the browser keeps the
    // /_next/image URL, so imgproxy can stay internal to the docker network.
    // Session cookies are stripped — imgproxy has no use for them.
    const headers = new Headers(request.headers)
    headers.delete('cookie')
    return NextResponse.rewrite(target.url, { request: { headers } })
  }

  const response = NextResponse.next()

  // Default the authenticated API surface to no-store. Most of these routes
  // return bare `new Response(JSON.stringify(...))` with no Cache-Control at
  // all, which leaves caching up to client heuristics — Apple's NSURLCache on
  // iOS/tvOS will heuristically cache a 200 GET that carries no freshness
  // info, which served the RN TV app stale videoURLs from the media endpoint.
  // Per-user payloads with playback URLs must never be stored by any cache.
  const { pathname } = request.nextUrl
  if (
    pathname.startsWith('/api/authenticated/') &&
    !SELF_CACHED_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  ) {
    response.headers.set('Cache-Control', 'no-store, private')
  }

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
    // Image optimizer requests are matched separately so they can be
    // offloaded to imgproxy when IMGPROXY_URL is configured (see above);
    // they return before the cookie-migration logic runs.
    '/_next/image',
  ],
}
