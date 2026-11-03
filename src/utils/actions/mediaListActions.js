/**
 * Server Actions for Media List Operations
 *
 * Thin wrappers around the cached server functions in
 * `src/utils/cache/mediaListData.js`. The wrappers exist solely so client
 * components (MovieListClient, TVListClient) can invoke the same data
 * fetchers over the Server Action RPC channel for filter-change refetches.
 *
 * Server-side (page handler) callers should import the cached versions
 * directly to get proper Cache Components caching, since `'use server'`
 * exports go through the action transport even when called from server code.
 *
 * Each checks its caller (approvedGate.action) and reads the user from the
 * session. They used to take `userId` from the caller: anyone, signed in or
 * not, could page through the library and read any user's watch history.
 */

'use server'

import { approvedGate } from '@src/lib/roles/gates'
import { libraryAccessFor } from '@src/lib/roles/libraryAccess'
import {
  getCachedMovieListData,
  getCachedTVListData,
} from '@src/utils/cache/mediaListData'

const strings = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [])

/**
 * The filter fields the list pages send, and nothing else: they are the cached
 * fetch's arguments, so its cache key too. Same keys, same order as the
 * page's own call (MovieListView/TVListView), so the two share cache entries.
 * `access` is the caller's library access, resolved from their session.
 */
function listOptions({ page, sortOrder, genres, hdrTypes, resolutions } = {}, userId, access) {
  return {
    page: Number.parseInt(page, 10) || undefined,
    sortOrder: typeof sortOrder === 'string' ? sortOrder : undefined,
    genres: strings(genres),
    hdrTypes: strings(hdrTypes),
    resolutions: strings(resolutions),
    userId,
    access,
  }
}

export async function getMovieListData(options = {}) {
  const user = await approvedGate.action('/list/movie')
  return getCachedMovieListData(listOptions(options, user.id, await libraryAccessFor(user)))
}

export async function getTVListData(options = {}) {
  const user = await approvedGate.action('/list/tv')
  return getCachedTVListData(listOptions(options, user.id, await libraryAccessFor(user)))
}
