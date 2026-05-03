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

function attachWatchHistory(items, watchMap) {
  return items.map(item => ({
    ...item,
    watchHistory: watchMap.get(item.videoURL) || {
      playbackTime: 0,
      lastWatched: null,
      isWatched: false,
    },
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
