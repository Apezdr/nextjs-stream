import { cacheLife, cacheTag } from 'next/cache'
import {
  getFilteredMovieList,
  getMovieFilterOptions,
  getFilteredMovieCount,
} from '@src/utils/mediaListUtils/movieListQueries'
import {
  getFilteredTVList,
  getTVFilterOptions,
  getFilteredTVCount,
} from '@src/utils/mediaListUtils/tvListQueries'
import { CONSTANTS } from '@src/utils/mediaListUtils/shared'
import { libraryAccessById } from '@src/lib/roles/libraryAccess'
import { getCurrentUserWatchHistory } from '@src/utils/watchHistoryServerUtils'
import { resolveWatchEntry, buildWatchHistoryObject } from '@src/utils/watchHistory/resolve'

function normalizeOptions(options = {}) {
  return {
    page: parseInt(options.page) || CONSTANTS.DEFAULT_PAGE,
    sortOrder: options.sortOrder || CONSTANTS.DEFAULT_SORT,
    genres: Array.isArray(options.genres) ? options.genres : [],
    hdrTypes: Array.isArray(options.hdrTypes) ? options.hdrTypes : [],
    resolutions: Array.isArray(options.resolutions) ? options.resolutions : [],
    userId: options.userId,
    scopeId: options.scopeId,
  }
}

// Same precedence as every other surface (mediaId → nid → hashed URLs → raw
// URLs). The raw-URL-only lookup this replaced could not see a row written
// through the JIT transcoder — 48% of rows at the time — so a title watched
// on the TV app showed no progress on these pages.
function attachWatchHistory(items, watchMap) {
  return items.map(item => ({
    ...item,
    watchHistory: buildWatchHistoryObject(item, resolveWatchEntry(item, watchMap)),
  }))
}

// options.scopeId: the viewer's scope id (LibraryAccess.id), part of the cache
// key with the filters (and the userId, for the watch history joined onto the
// page); the access is resolved again inside
export async function getCachedMovieListData(options) {
  'use cache'
  cacheLife('mediaLists')
  cacheTag('media-library', 'movies', 'movie-list', `user-watch-history-${options.userId}`)

  const { page, sortOrder, genres, hdrTypes, resolutions, userId, scopeId } = normalizeOptions(options)
  const access = await libraryAccessById(scopeId)

  const [items, totalCount, filterOptions, watchMap] = await Promise.all([
    getFilteredMovieList({ access, page, limit: CONSTANTS.DEFAULT_LIMIT, sortOrder, genres, hdrTypes, resolutions }),
    getFilteredMovieCount({ access, genres, hdrTypes, resolutions }),
    getMovieFilterOptions(access),
    getCurrentUserWatchHistory(userId),
  ])

  const totalPages = Math.ceil(totalCount / CONSTANTS.DEFAULT_LIMIT)

  return {
    items: attachWatchHistory(items, watchMap),
    totalCount,
    totalPages,
    currentPage: page,
    filterOptions,
    currentFilters: { sortOrder, genres, hdrTypes, resolutions },
  }
}

export async function getCachedTVListData(options) {
  'use cache'
  cacheLife('mediaLists')
  cacheTag('media-library', 'tv', 'tv-list', `user-watch-history-${options.userId}`)

  const { page, sortOrder, genres, hdrTypes, resolutions, userId, scopeId } = normalizeOptions(options)
  const access = await libraryAccessById(scopeId)

  const [items, totalCount, filterOptions, watchMap] = await Promise.all([
    getFilteredTVList({ access, page, limit: CONSTANTS.DEFAULT_LIMIT, sortOrder, genres, hdrTypes, resolutions }),
    getFilteredTVCount({ access, genres, hdrTypes, resolutions }),
    getTVFilterOptions(access),
    getCurrentUserWatchHistory(userId),
  ])

  const totalPages = Math.ceil(totalCount / CONSTANTS.DEFAULT_LIMIT)

  return {
    items: attachWatchHistory(items, watchMap),
    totalCount,
    totalPages,
    currentPage: page,
    filterOptions,
    currentFilters: { sortOrder, genres, hdrTypes, resolutions },
  }
}
