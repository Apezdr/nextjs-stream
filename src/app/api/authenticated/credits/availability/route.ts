import { isAuthenticatedAndApproved } from '@src/utils/routeAuth'
import { getCreditsAvailability } from '@src/utils/credits/catalog'

/**
 * GET /api/authenticated/credits/availability
 *
 * Whether to show the "Credits & licenses" menu item, without the catalog:
 *
 *   { "available": true, "library": true, "titles": 4 }
 *
 * `available` is true when the library has credits to show or any title the
 * user may see does (inherited episode credits included, as their show has
 * them). `titles` counts those titles; it is 0 for a user with limited
 * access, who sees no titles. A failed read answers 500: a client keeps what
 * it last knew rather than taking it for "no credits".
 */
export async function GET(req: Request) {
  const user = await isAuthenticatedAndApproved(req)
  if (user instanceof Response) return user

  try {
    const availability = await getCreditsAvailability({ includeTitles: (user as any).limitedAccess !== true })
    return Response.json(availability, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('[credits] availability read failed:', error instanceof Error ? error.message : error)
    return Response.json({ error: 'Could not read the credits' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
