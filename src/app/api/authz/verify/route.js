import { getSession } from '@src/lib/cachedAuth'
import { isGatedAuthUrl } from '@src/utils/gatedAuthOrigins'

// Forward-auth gate for reverse-proxied apps (Organizr today, others later).
// Admin-only for now; broaden the check here if non-admin roles need in later.
export async function GET(req) {
  const session = await getSession()
  const user = session?.user

  if (user && user.role === 'admin') {
    return new Response(null, {
      status: 200,
      headers: { 'X-Auth-Verified-User': user.email },
    })
  }

  const signInRedirect = !user ? buildSignInRedirect(req) : null
  if (signInRedirect) {
    return new Response(null, { status: 302, headers: { Location: signInRedirect } })
  }

  return new Response(null, { status: 403 })
}

// Caddy sets X-Forwarded-* on this subrequest from its own view of the original
// request; only trustworthy because that hop isn't reachable from outside this host.
// The redirect target is still checked against an explicit allow-list — never built
// from a forwarded header alone — so this can't be turned into an open redirect.
function buildSignInRedirect(req) {
  const proto = req.headers.get('x-forwarded-proto')
  const host = req.headers.get('x-forwarded-host')
  const uri = req.headers.get('x-forwarded-uri') || '/'
  if (!proto || !host) return null

  // Allow-list entries may be a bare origin or an origin+path prefix
  // (Organizr is reverse-proxied under a subpath, not its own subdomain).
  const requestedUrl = `${proto}://${host}${uri}`
  if (!isGatedAuthUrl(requestedUrl)) return null

  const ownOrigin = process.env.NEXT_PUBLIC_BASE_URL || process.env.BETTER_AUTH_URL
  if (!ownOrigin) return null

  return `${ownOrigin}/auth/signin?callbackUrl=${encodeURIComponent(requestedUrl)}`
}
