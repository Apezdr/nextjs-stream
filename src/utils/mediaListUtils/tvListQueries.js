/**
 * TV List Query Functions
 * 
 * Dedicated database query functions for TV list view with server-side
 * filtering, sorting, and pagination. Handles complex nested episode/season structure.
 */

import clientPromise from '@src/lib/mongodb'
import { getFullImageUrl } from '@src/utils'
import {
  serializeForClient,
  validatePaginationParams,
  buildSortQuery,
  buildGenreFilter,
  CONSTANTS
} from './shared'

/**
 * Get filtered, sorted, and paginated TV show list
 * Includes seasons and episodes with HDR information
 * 
 * NOTE: This function assumes 'availableHdrTypes' field is pre-computed on FlatTVShows
 * during sync. If not available, HDR filtering will be skipped.
 * 
 * @param {Object} options - Query options
 * @param {number} [options.page=1] - Page number (1-based)
 * @param {number} [options.limit=20] - Items per page
 * @param {string} [options.sortOrder='newest'] - Sort order ('newest' or 'oldest')
 * @param {Array<string>} [options.genres=[]] - Genre names to filter by (AND logic)
 * @param {Array<string>} [options.hdrTypes=[]] - HDR types to filter by (OR logic)
 * @returns {Promise<Array>} Array of TV show objects with seasons/episodes
 */
export async function getFilteredTVList({
  page = CONSTANTS.DEFAULT_PAGE,
  limit = CONSTANTS.DEFAULT_LIMIT,
  sortOrder = CONSTANTS.DEFAULT_SORT,
  genres = [],
  hdrTypes = []
}) {
  try {
    const client = await clientPromise;
    const db = client.db('Media');
    
    // Validate and normalize pagination params
    const { page: validPage, limit: validLimit, skip } = validatePaginationParams(page, limit);
    
    let tvShows;
    
    // If HDR filtering is requested, use aggregation to check episodes
    // This is needed because availableHdrTypes is not yet pre-computed on FlatTVShows
    if (hdrTypes && hdrTypes.length > 0) {
      // Build regex pattern for HDR matching
      const hdrRegexPattern = hdrTypes.map(type => {
        return type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('|');
      const hdrRegex = new RegExp(hdrRegexPattern, 'i');
      
      // Use aggregation pipeline to filter by episodes with HDR
      const pipeline = [
        // Match TV shows by genre if specified
        ...(genres.length > 0 ? [{ $match: buildGenreFilter(genres) }] : []),
        
        // Lookup episodes for each show
        {
          $lookup: {
            from: 'FlatEpisodes',
            localField: '_id',
            foreignField: 'showId',
            as: 'episodes'
          }
        },
        
        // Filter to shows that have at least one episode with matching HDR
        {
          $match: {
            'episodes.hdr': hdrRegex
          }
        },
        
        // Project only the fields we need (remove episodes array to reduce data transfer)
        {
          $project: {
            _id: 1,
            title: 1,
            posterURL: 1,
            posterBlurhash: 1,
            posterBlurhashSource: 1,
            metadata: 1
          }
        },
        
        // Sort
        { $sort: buildSortQuery(sortOrder, 'metadata.last_air_date') },
        
        // Pagination
        { $skip: skip },
        { $limit: validLimit }
      ];
      
      tvShows = await db.collection('FlatTVShows').aggregate(pipeline).toArray();
    } else {
      // No HDR filtering - use simple find query
      const matchQuery = buildGenreFilter(genres);
      const sortQuery = buildSortQuery(sortOrder, 'metadata.last_air_date');
      
      const tvShowProjection = {
        _id: 1,
        title: 1,
        posterURL: 1,
        posterBlurhash: 1,
        posterBlurhashSource: 1,
        metadata: 1
      };
      
      tvShows = await db
        .collection('FlatTVShows')
        .find(matchQuery, { projection: tvShowProjection })
        .sort(sortQuery)
        .skip(skip)
        .limit(validLimit)
        .toArray();
    }
    
    // For each TV show, fetch its seasons and episodes
    const tvShowsWithSeasons = await Promise.all(
      tvShows.map(async (tvShow) => {
        // Ensure poster URL
        let posterURL = tvShow.posterURL;
        if (!posterURL && tvShow.metadata?.poster_path) {
          posterURL = getFullImageUrl(tvShow.metadata.poster_path, 'w780');
        }
        if (!posterURL) {
          posterURL = '/sorry-image-not-available.jpg';
        }
        
        // Fetch seasons for this TV show
        const seasons = await db
          .collection('FlatSeasons')
          .find({ showId: tvShow._id })
          .sort({ seasonNumber: 1 })
          .toArray();
        
        // For each season, fetch episodes with minimal required data
        const seasonsWithEpisodes = await Promise.all(
          seasons.map(async (season) => {
            // Fetch episodes for this season
            const episodes = await db
              .collection('FlatEpisodes')
              .find(
                { seasonId: season._id },
                {
                  projection: {
                    _id: 1,
                    episodeNumber: 1,
                    dimensions: 1,
                    hdr: 1
                  }
                }
              )
              .sort({ episodeNumber: 1 })
              .toArray();
            
            // Serialize episode data
            const serializedEpisodes = episodes.map(episode => ({
              _id: episode._id.toString(),
              episodeNumber: episode.episodeNumber,
              dimensions: episode.dimensions || '0x0',
              hdr: episode.hdr || false
            }));
            
            return {
              _id: season._id.toString(),
              seasonNumber: season.seasonNumber,
              title: season.title || null,
              episodes: serializedEpisodes
            };
          })
        );
        
        return {
          _id: tvShow._id.toString(),
          id: tvShow._id.toString(),
          title: tvShow.title,
          posterURL,
          posterBlurhash: tvShow.posterBlurhash || null,
          metadata: tvShow.metadata || {},
          link: encodeURIComponent(tvShow.title) || null,
          type: 'tv',
          seasons: seasonsWithEpisodes,
          availableHdrTypes: tvShow.availableHdrTypes || [] // Include for reference
        };
      })
    );
    
    // Serialize for client transfer
    return serializeForClient(tvShowsWithSeasons);
  } catch (error) {
    console.error(`Error in getFilteredTVList: ${error.message}`);
    throw error;
  }
}

/**
 * Get total count of TV shows matching the specified filters
 * Used for pagination UI
 * 
 * @param {Object} options - Filter options
 * @param {Array<string>} [options.genres=[]] - Genre names to filter by
 * @param {Array<string>} [options.hdrTypes=[]] - HDR types to filter by
 * @returns {Promise<number>} Total count of matching TV shows
 */
export async function getFilteredTVCount({
  genres = [],
  hdrTypes = []
}) {
  try {
    const client = await clientPromise;
    const db = client.db('Media');
    
    // If HDR filtering is requested, use aggregation
    if (hdrTypes && hdrTypes.length > 0) {
      // Build regex pattern for HDR matching
      const hdrRegexPattern = hdrTypes.map(type => {
        return type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('|');
      const hdrRegex = new RegExp(hdrRegexPattern, 'i');
      
      // Use aggregation pipeline to count
      const pipeline = [
        // Match TV shows by genre if specified
        ...(genres.length > 0 ? [{ $match: buildGenreFilter(genres) }] : []),
        
        // Lookup episodes for each show
        {
          $lookup: {
            from: 'FlatEpisodes',
            localField: '_id',
            foreignField: 'showId',
            as: 'episodes'
          }
        },
        
        // Filter to shows that have at least one episode with matching HDR
        {
          $match: {
            'episodes.hdr': hdrRegex
          }
        },
        
        // Count
        { $count: 'total' }
      ];
      
      const result = await db.collection('FlatTVShows').aggregate(pipeline).toArray();
      return result.length > 0 ? result[0].total : 0;
    } else {
      // No HDR filtering - use simple count
      const matchQuery = buildGenreFilter(genres);
      return await db.collection('FlatTVShows').countDocuments(matchQuery);
    }
  } catch (error) {
    console.error(`Error in getFilteredTVCount: ${error.message}`);
    throw error;
  }
}

/**
 * Get available filter options for TV shows
 * Returns unique genres and HDR types available in the entire TV library
 * 
 * NOTE: HDR types are extracted from pre-computed 'availableHdrTypes' field.
 * If this field doesn't exist, will return empty array for HDR types.
 * 
 * @returns {Promise<Object>} Object with availableGenres and availableHdrTypes arrays
 */
export async function getTVFilterOptions() {
  try {
    const client = await clientPromise;
    const db = client.db('Media');
    
    // Use aggregation to get unique genres efficiently
    const genreResults = await db
      .collection('FlatTVShows')
      .aggregate([
        { $unwind: '$metadata.genres' },
        { $group: { _id: '$metadata.genres.name' } },
        { $sort: { _id: 1 } }
      ])
      .toArray();
    
    const availableGenres = genreResults.map(result => result._id).filter(Boolean);
    
    // Get unique HDR types from pre-computed field
    // This assumes the sync process has calculated availableHdrTypes for each show
    const hdrResults = await db
      .collection('FlatTVShows')
      .aggregate([
        { $match: { availableHdrTypes: { $exists: true, $ne: [] } } },
        { $unwind: '$availableHdrTypes' },
        { $group: { _id: '$availableHdrTypes' } },
        { $sort: { _id: 1 } }
      ])
      .toArray();
    
    const availableHdrTypes = hdrResults.map(result => result._id).filter(Boolean);
    
    // If no pre-computed HDR types, fall back to querying episodes directly
    // This is slower but ensures we always have accurate data
    if (availableHdrTypes.length === 0) {
      const episodeHdrResults = await db
        .collection('FlatEpisodes')
        .aggregate([
          { $match: { hdr: { $exists: true, $nin: [null, false, ''] } } },
          { $group: { _id: '$hdr' } },
          { $sort: { _id: 1 } }
        ])
        .toArray();
      
      // Process HDR types (handle comma-separated values)
      const hdrSet = new Set();
      episodeHdrResults.forEach(result => {
        if (result._id && typeof result._id === 'string') {
          result._id.split(',').forEach(type => {
            const trimmed = type.trim();
            if (trimmed) hdrSet.add(trimmed);
          });
        } else if (result._id === true) {
          hdrSet.add('HDR');
        }
      });
      
      return {
        availableGenres,
        availableHdrTypes: Array.from(hdrSet).sort()
      };
    }
    
    return {
      availableGenres,
      availableHdrTypes
    };
  } catch (error) {
    console.error(`Error in getTVFilterOptions: ${error.message}`);
    throw error;
  }
}

/**
 * Get TV show statistics (show count, episode count, and total duration)
 * Used for displaying summary information in the UI
 * 
 * @returns {Promise<Object>} Object with count, episodeCount, and totalDuration
 */
export async function getTVStatistics() {
  try {
    const client = await clientPromise;
    const db = client.db('Media');
    
    // Get episode statistics (count and total duration)
    const episodeResult = await db
      .collection('FlatEpisodes')
      .aggregate([
        {
          $group: {
            _id: null,
            episodeCount: { $sum: 1 },
            totalDuration: { $sum: { $ifNull: ['$duration', 0] } }
          }
        }
      ])
      .toArray();
    
    // Get TV show count
    const showCount = await db.collection('FlatTVShows').countDocuments();
    
    return {
      count: showCount,
      episodeCount: episodeResult.length > 0 ? episodeResult[0].episodeCount : 0,
      totalDuration: episodeResult.length > 0 ? episodeResult[0].totalDuration : 0
    };
  } catch (error) {
    console.error(`Error in getTVStatistics: ${error.message}`);
    return { count: 0, episodeCount: 0, totalDuration: 0 };
  }
}