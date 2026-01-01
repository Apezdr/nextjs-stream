/**
 * Server Actions for Media List Operations
 * 
 * These Server Actions use Next.js 16's 'use cache' directive for optimal performance.
 * They wrap database query functions and provide a consistent API for client components.
 * 
 * Cache Strategy:
 * - cacheLife('minutes'): 5min client stale, 1min server revalidate, 1hr expire
 * - Tagged for selective invalidation when media library updates
 * - FormData automatically included in cache key by Next.js
 */

'use server'

import { cacheLife, cacheTag } from 'next/cache'
import {
  getFilteredMovieList,
  getMovieFilterOptions,
  getFilteredMovieCount,
  getMovieStatistics
} from '@src/utils/mediaListUtils/movieListQueries'
import {
  getFilteredTVList,
  getTVFilterOptions,
  getFilteredTVCount,
  getTVStatistics
} from '@src/utils/mediaListUtils/tvListQueries'
import { parseCommaSeparated, CONSTANTS } from '@src/utils/mediaListUtils/shared'

/**
 * Server Action: Get filtered and paginated movie list data
 *
 * This function is cached using Next.js 16's 'use cache' directive.
 * Different filter combinations create separate cache entries automatically.
 *
 * @param {Object} options - Filter parameters
 *   - page: Page number (default: 1)
 *   - sortOrder: 'newest' or 'oldest' (default: 'newest')
 *   - genres: Array of genre names (default: [])
 *   - hdrTypes: Array of HDR types (default: [])
 * @returns {Promise<Object>} Object containing items, pagination info, and filter options
 */
export async function getMovieListData(options = {}) {
  'use cache'
  cacheLife('minutes')
  cacheTag('media-library', 'movies', 'movie-list')
  
  // Parse and validate options
  const page = parseInt(options.page) || CONSTANTS.DEFAULT_PAGE;
  const sortOrder = options.sortOrder || CONSTANTS.DEFAULT_SORT;
  const genres = Array.isArray(options.genres) ? options.genres : [];
  const hdrTypes = Array.isArray(options.hdrTypes) ? options.hdrTypes : [];
  const resolutions = Array.isArray(options.resolutions) ? options.resolutions : [];
  
  // Parallel queries for optimal performance
  const [items, totalCount, filterOptions, statistics] = await Promise.all([
    getFilteredMovieList({ page, limit: CONSTANTS.DEFAULT_LIMIT, sortOrder, genres, hdrTypes, resolutions }),
    getFilteredMovieCount({ genres, hdrTypes, resolutions }),
    getMovieFilterOptions(),
    getMovieStatistics()
  ]);
  
  // Calculate pagination metadata
  const totalPages = Math.ceil(totalCount / CONSTANTS.DEFAULT_LIMIT);
  
  return {
    items,
    totalCount,
    totalPages,
    currentPage: page,
    filterOptions,
    statistics,
    // Include current filter state for UI
    currentFilters: {
      sortOrder,
      genres,
      hdrTypes,
      resolutions
    }
  };
}

/**
 * Server Action: Get filtered and paginated TV show list data
 *
 * This function is cached using Next.js 16's 'use cache' directive.
 * Different filter combinations create separate cache entries automatically.
 *
 * @param {Object} options - Filter parameters
 *   - page: Page number (default: 1)
 *   - sortOrder: 'newest' or 'oldest' (default: 'newest')
 *   - genres: Array of genre names (default: [])
 *   - hdrTypes: Array of HDR types (default: [])
 * @returns {Promise<Object>} Object containing items, pagination info, and filter options
 */
export async function getTVListData(options = {}) {
  'use cache'
  cacheLife('minutes')
  cacheTag('media-library', 'tv', 'tv-list')
  
  // Parse and validate options
  const page = parseInt(options.page) || CONSTANTS.DEFAULT_PAGE;
  const sortOrder = options.sortOrder || CONSTANTS.DEFAULT_SORT;
  const genres = Array.isArray(options.genres) ? options.genres : [];
  const hdrTypes = Array.isArray(options.hdrTypes) ? options.hdrTypes : [];
  const resolutions = Array.isArray(options.resolutions) ? options.resolutions : [];
  
  // Parallel queries for optimal performance
  const [items, totalCount, filterOptions, statistics] = await Promise.all([
    getFilteredTVList({ page, limit: CONSTANTS.DEFAULT_LIMIT, sortOrder, genres, hdrTypes, resolutions }),
    getFilteredTVCount({ genres, hdrTypes, resolutions }),
    getTVFilterOptions(),
    getTVStatistics()
  ]);
  
  // Calculate pagination metadata
  const totalPages = Math.ceil(totalCount / CONSTANTS.DEFAULT_LIMIT);
  
  return {
    items,
    totalCount,
    totalPages,
    currentPage: page,
    filterOptions,
    statistics,
    // Include current filter state for UI
    currentFilters: {
      sortOrder,
      genres,
      hdrTypes,
      resolutions
    }
  };
}