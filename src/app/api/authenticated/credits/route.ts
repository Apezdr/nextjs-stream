import { isAuthenticatedAndApproved } from '@src/utils/routeAuth'
import { getCreditsCatalog } from '@src/utils/credits/catalog'

/**
 * GET /api/authenticated/credits
 *
 * What the "Credits & licenses" page shows (CREDITS_SIDECAR.md, section 7):
 *
 * {
 *   "library": { "schemaVersion": 1, "entries": [...] } | null,
 *   "titles": [
 *     { "type": "movie", "id": "...", "title": "...", "originalTitle": "..." },
 *     { "type": "tv", "id": "...", "title": "...", "originalTitle": "...",
 *       "hasCredits": true,
 *       "episodes": [{ "seasonNumber": 1, "episodeNumber": 3, "title": "..." }] }
 *   ]
 * }
 *
 * `library` is the library's own credits, resolved for display as a title's
 * are. `titles` names every title the user may see that has credits to show,
 * by display title; a show lists the episodes that have credits of their own.
 * The credits of a title are on its page, not here. A user with limited
 * access gets the library's credits and no titles. A failed read answers 500,
 * never an empty catalog.
 */
export async function GET(req: Request) {
  const user = await isAuthenticatedAndApproved(req)
  if (user instanceof Response) return user

  try {
    const catalog = await getCreditsCatalog({ includeTitles: (user as any).limitedAccess !== true })
    return Response.json(catalog, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('[credits] catalog read failed:', error instanceof Error ? error.message : error)
    return Response.json({ error: 'Could not read the credits' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
