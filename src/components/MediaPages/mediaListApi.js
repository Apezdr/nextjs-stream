/**
 * The list pages' reads from the browser: a page of the movie or TV list on a
 * filter, sort or page change, and an empty season's "Try again". GETs to
 * /api/authenticated/media-list, which read the user from the session.
 *
 * They were Server Actions, and the "View as" guard refuses every Server
 * Action (src/lib/viewAsGuard.ts). A GET is a read it lets through.
 *
 * A signed-out caller is sent to sign-in, back here after, and an account
 * awaiting approval to the approval page, as the actions' redirects did; the
 * call then resolves null (the page is leaving). Any other failure throws.
 *
 * Client-only (fetch, location); no React.
 */
import { listSearchParams } from '@src/utils/mediaListUtils/listRequest'

const BASE = '/api/authenticated/media-list'

/** Where a refused read sends the browser, or null to treat it as a failure. */
function refusalDestination(response, body) {
  if (response.status === 401) {
    const here = `${window.location.pathname}${window.location.search}`
    return `/auth/signin?callbackUrl=${encodeURIComponent(here)}`
  }
  if (response.status === 403 && body?.code === 'APPROVAL_PENDING') return '/auth/error?error=APPROVAL_PENDING'
  return null
}

async function read(path, what) {
  const response = await fetch(path, { headers: { Accept: 'application/json' } })
  const body = await response.json().catch(() => null)
  if (response.ok) return body
  const destination = refusalDestination(response, body)
  if (destination) {
    window.location.assign(destination)
    return null
  }
  throw new Error(`Couldn’t load ${what} (${response.status})`)
}

/** A page of the movie list for these filters, or null when the page is leaving. */
export function fetchMovieListData(options) {
  return read(`${BASE}/movie?${listSearchParams(options)}`, 'the movies')
}

/** A page of the TV list for these filters, or null when the page is leaving. */
export function fetchTVListData(options) {
  return read(`${BASE}/tv?${listSearchParams(options)}`, 'the shows')
}

/**
 * Whether the season has episodes now: { success, hasEpisodes }, or null when
 * the page is leaving. showTitle as the page has it, decoded.
 */
export function fetchSeasonHasEpisodes({ showTitle, seasonNumber }) {
  const query = new URLSearchParams({ showTitle: String(showTitle ?? ''), seasonNumber: String(seasonNumber ?? '') })
  return read(`${BASE}/season-episodes?${query}`, 'the season')
}
