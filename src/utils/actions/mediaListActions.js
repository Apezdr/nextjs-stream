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
 */

'use server'

import {
  getCachedMovieListData,
  getCachedTVListData,
} from '@src/utils/cache/mediaListData'

export async function getMovieListData(options = {}) {
  return getCachedMovieListData(options)
}

export async function getTVListData(options = {}) {
  return getCachedTVListData(options)
}
