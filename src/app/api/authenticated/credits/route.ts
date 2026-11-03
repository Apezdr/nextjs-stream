import { approvedGate } from '@src/lib/roles/gates'
import { getCreditsCatalog } from '@src/utils/credits/catalog'
import { libraryAccessFor } from '@src/lib/roles/libraryAccess'

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
 * The credits of a title are on its page, not here. Only titles in the
 * user's library scope are named. A failed read answers 500, never an empty
 * catalog.
 */
export async function GET(req: Request) {
  const user = await approvedGate.route()
  if (user instanceof Response) return user

  try {
    const catalog = await getCreditsCatalog(await libraryAccessFor(user))
    return Response.json(catalog, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('[credits] catalog read failed:', error instanceof Error ? error.message : error)
    return Response.json({ error: 'Could not read the credits' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
