import { isAuthenticatedAndApproved } from '@src/utils/routeAuth'
import { horizontalListChanges } from '../horizontal-list/changes'
import { watchlistContentChanges } from '../watchlist-content/changes'
import { bannerChanges } from '../banner/changes'
import { homeRowsChanges } from '../home-rows/changes'

/**
 * GET /api/authenticated/changes
 *
 * Opaque stamps, keyed by the route they describe, for clients that keep
 * lists on screen: poll this (it is cheap: the session check and memory
 * reads, no list is built) and repeat a list request only when its stamp
 * moved. Stamps are only compared for equality; their contents mean nothing.
 *
 * {
 *   "horizontal-list": { "recentlyWatched", "recentlyAdded", "movie", "tv", "all",
 *                        "recommendations", "playlist" },
 *   "watchlist-content": "…",
 *   "banner": "…",
 *   "home-rows": "…"
 * }
 *
 * Each route's stamps are defined beside it (horizontal-list/changes.js and so
 * on); the revisions behind them are in src/utils/changes/revisions.js.
 */
export async function GET(req) {
  const user = await isAuthenticatedAndApproved(req)
  if (user instanceof Response) return user

  return Response.json(
    {
      'horizontal-list': horizontalListChanges(user.id),
      'watchlist-content': watchlistContentChanges(),
      banner: bannerChanges(),
      'home-rows': homeRowsChanges(user.id),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
