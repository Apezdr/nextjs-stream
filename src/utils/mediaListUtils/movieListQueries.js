/**
 * Movie List Query Functions
 * 
 * Dedicated database query functions for movie list view with server-side
 * filtering, sorting, and pagination. These are called by Server Actions.
 */

import clientPromise from '@src/lib/mongodb'
import { getFullImageUrl } from '@src/utils'
import {
  serializeForClient,
  validatePaginationParams,
  buildSortQuery,
  buildGenreFilter,
  buildHdrFilter,
  buildResolutionFilter,
  dimensionsToResolution,
  CONSTANTS
} from './shared'

/**
 * Get filtered, sorted, and paginated movie list
 * Performs all operations at the database level for optimal performance
 * 
 * @param {Object} options - Query options
 * @param {number} [options.page=1] - Page number (1-based)
 * @param {number} [options.limit=20] - Items per page
 * @param {string} [options.sortOrder='newest'] - Sort order ('newest' or 'oldest')
 * @param {Array<string>} [options.genres=[]] - Genre names to filter by (AND logic)
 * @param {Array<string>} [options.hdrTypes=[]] - HDR types to filter by (OR logic)
 * @returns {Promise<Array>} Array of movie objects matching filters
 */
export async function getFilteredMovieList({
  page = CONSTANTS.DEFAULT_PAGE,
  limit = CONSTANTS.DEFAULT_LIMIT,
  sortOrder = CONSTANTS.DEFAULT_SORT,
  genres = [],
  hdrTypes = [],
  resolutions = []
}) {
  try {
    const client = await clientPromise;
    const db = client.db('Media');
    
    // Validate and normalize pagination params
    const { page: validPage, limit: validLimit, skip } = validatePaginationParams(page, limit);
    
    // Build match query with filters
    const matchQuery = {
      ...buildGenreFilter(genres),
      ...buildHdrFilter(hdrTypes),
      ...buildResolutionFilter(resolutions)
    };
    
    // Build sort query
    const sortQuery = buildSortQuery(sortOrder, 'metadata.release_date');
    
    // Full projection initially - will optimize after validation
    const projection = {
      _id: 1,
      title: 1,
      posterURL: 1,
      posterBlurhash: 1,
      posterBlurhashSource: 1,
      backdrop: 1,
      backdropBlurhash: 1,
      backdropBlurhashSource: 1,
      dimensions: 1,
      hdr: 1,
      duration: 1,
      videoURL: 1,
      normalizedVideoId: 1,
      captionURLs: 1,
      metadata: 1 // Full metadata for now
    };
    
    // Execute query with pagination
    const movies = await db
      .collection('FlatMovies')
      .find(matchQuery, { projection })
      .sort(sortQuery)
      .skip(skip)
      .limit(validLimit)
      .toArray();
    
    // Process movies to ensure proper URLs
    const processedMovies = movies.map(movie => {
      // Ensure poster URL
      let posterURL = movie.posterURL;
      if (!posterURL && movie.metadata?.poster_path) {
        posterURL = getFullImageUrl(movie.metadata.poster_path, 'w780');
      }
      if (!posterURL) {
        posterURL = '/sorry-image-not-available.jpg';
      }
      
      // Ensure backdrop URL
      let backdrop = movie.backdrop;
      if (!backdrop && movie.metadata?.backdrop_path) {
        backdrop = getFullImageUrl(movie.metadata.backdrop_path, 'original');
      }
      
      return {
        ...movie,
        posterURL,
        backdrop,
        link: encodeURIComponent(movie.title) || null,
        type: 'movie'
      };
    });
    
    // Serialize for client transfer
    return serializeForClient(processedMovies);
  } catch (error) {
    console.error(`Error in getFilteredMovieList: ${error.message}`);
    throw error;
  }
}

/**
 * Get total count of movies matching the specified filters
 * Used for pagination UI
 * 
 * @param {Object} options - Filter options
 * @param {Array<string>} [options.genres=[]] - Genre names to filter by
 * @param {Array<string>} [options.hdrTypes=[]] - HDR types to filter by
 * @returns {Promise<number>} Total count of matching movies
 */
export async function getFilteredMovieCount({
  genres = [],
  hdrTypes = [],
  resolutions = []
}) {
  try {
    const client = await clientPromise;
    const db = client.db('Media');
    
    // Build match query with filters
    const matchQuery = {
      ...buildGenreFilter(genres),
      ...buildHdrFilter(hdrTypes),
      ...buildResolutionFilter(resolutions)
    };
    
    // Get count
    const count = await db
      .collection('FlatMovies')
      .countDocuments(matchQuery);
    
    return count;
  } catch (error) {
    console.error(`Error in getFilteredMovieCount: ${error.message}`);
    throw error;
  }
}

/**
 * Get available filter options for movies
 * Returns unique genres and HDR types available in the entire movie library
 * Used to populate filter dropdowns/buttons
 * 
 * @returns {Promise<Object>} Object with availableGenres and availableHdrTypes arrays
 */
export async function getMovieFilterOptions() {
  try {
    const client = await clientPromise;
    const db = client.db('Media');
    
    // Use aggregation to get unique genres efficiently
    const genreResults = await db
      .collection('FlatMovies')
      .aggregate([
        { $unwind: '$metadata.genres' },
        { $group: { _id: '$metadata.genres.name' } },
        { $sort: { _id: 1 } }
      ])
      .toArray();
    
    const availableGenres = genreResults.map(result => result._id).filter(Boolean);
    
    // Use aggregation to get unique HDR types
    const hdrResults = await db
      .collection('FlatMovies')
      .aggregate([
        { $match: { hdr: { $exists: true, $nin: [null, false] } } },
        { $group: { _id: '$hdr' } },
        { $sort: { _id: 1 } }
      ])
      .toArray();
    
    // Process HDR types (handle comma-separated values)
    const hdrSet = new Set();
    hdrResults.forEach(result => {
      if (result._id && typeof result._id === 'string') {
        result._id.split(',').forEach(type => {
          const trimmed = type.trim();
          if (trimmed) hdrSet.add(trimmed);
        });
      } else if (result._id === true) {
        hdrSet.add('HDR');
      }
    });
    
    const availableHdrTypes = Array.from(hdrSet).sort();
    
    // Get unique resolutions from dimensions
    const resolutionResults = await db
      .collection('FlatMovies')
      .aggregate([
        { $match: { dimensions: { $exists: true, $ne: null } } },
        { $group: { _id: '$dimensions' } }
      ])
      .toArray();
    
    const resolutionSet = new Set();
    resolutionResults.forEach(result => {
      const resLabel = dimensionsToResolution(result._id);
      if (resLabel) resolutionSet.add(resLabel);
    });
    
    // Sort by quality descending
    const availableResolutions = Array.from(resolutionSet).sort((a, b) => {
      const order = { '4K': 4, '1080p': 3, '720p': 2, 'SD': 1 };
      return (order[b] || 0) - (order[a] || 0);
    });
    
    return {
      availableGenres,
      availableHdrTypes,
      availableResolutions
    };
  } catch (error) {
    console.error(`Error in getMovieFilterOptions: ${error.message}`);
    throw error;
  }
}

/**
 * Get movie statistics (count and total duration)
 * Used for displaying summary information in the UI
 * 
 * @returns {Promise<Object>} Object with count and totalDuration
 */
export async function getMovieStatistics() {
  try {
    const client = await clientPromise;
    const db = client.db('Media');
    
    const result = await db
      .collection('FlatMovies')
      .aggregate([
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            totalDuration: { $sum: { $ifNull: ['$duration', 0] } }
          }
        }
      ])
      .toArray();
    
    return {
      count: result.length > 0 ? result[0].count : 0,
      totalDuration: result.length > 0 ? result[0].totalDuration : 0
    };
  } catch (error) {
    console.error(`Error in getMovieStatistics: ${error.message}`);
    return { count: 0, totalDuration: 0 };
  }
}