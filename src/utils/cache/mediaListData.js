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

export async function getCachedMovieListData(options = {}) {
  'use cache'
  cacheLife('mediaLists')
  cacheTag('media-library', 'movies', 'movie-list', `user-watch-history-${options.userId}`)

  const { page, sortOrder, genres, hdrTypes, resolutions, userId } = normalizeOptions(options)

  const [items, totalCount, filterOptions, watchMap] = await Promise.all([
    getFilteredMovieList({ page, limit: CONSTANTS.DEFAULT_LIMIT, sortOrder, genres, hdrTypes, resolutions }),
    getFilteredMovieCount({ genres, hdrTypes, resolutions }),
    getMovieFilterOptions(),
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

export async function getCachedTVListData(options = {}) {
  'use cache'
  cacheLife('mediaLists')
  cacheTag('media-library', 'tv', 'tv-list', `user-watch-history-${options.userId}`)

  const { page, sortOrder, genres, hdrTypes, resolutions, userId } = normalizeOptions(options)

  const [items, totalCount, filterOptions, watchMap] = await Promise.all([
    getFilteredTVList({ page, limit: CONSTANTS.DEFAULT_LIMIT, sortOrder, genres, hdrTypes, resolutions }),
    getFilteredTVCount({ genres, hdrTypes, resolutions }),
    getTVFilterOptions(),
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
