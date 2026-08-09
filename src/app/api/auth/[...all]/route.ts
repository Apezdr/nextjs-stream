import { auth } from '@src/lib/auth'
import { toNextJsHandler } from 'better-auth/next-js'
import { getLocalOwnerSession } from '@src/lib/localOwnerSession'

const handlers = toNextJsHandler(auth)

export const POST = handlers.POST

/**
 * Better Auth owns this route, so `resolveSession()` never runs here and the
 * local-access owner stays invisible to `authClient.useSession()` — which every
 * client component, including the admin layout's role check, depends on.
 * Only substitutes when Better Auth itself found no session.
 */
export async function GET(request: Request) {
  const response = await handlers.GET(request)

  if (!new URL(request.url).pathname.endsWith('/get-session')) return response

  let body: unknown = null
  try {
    body = await response.clone().json()
  } catch {
    // Better Auth sends an empty body when there is no session.
  }
  if (body && typeof body === 'object' && 'user' in (body as Record<string, unknown>)) {
    return response
  }

  const local = await getLocalOwnerSession(request.headers)
  if (!local) return response

  // Per-request assertion and a flippable toggle: never cache this.
  return Response.json(local, { headers: { 'Cache-Control': 'no-store' } })
}
