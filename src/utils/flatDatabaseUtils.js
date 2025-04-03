import clientPromise from '@src/lib/mongodb'
import { auth } from '../lib/auth'
import { ObjectId } from 'mongodb'
import {
  arrangeMediaByLatestModification,
  processWatchedDetails,
  sanitizeRecord
} from '@src/utils/auth_utils'
import { getFullImageUrl } from '@src/utils'

/**
 * Gets posters for movies or TV shows from the flat database structure.
 * Note: This function uses 1-based pagination (page 1 is first page)
 *
 * @param {string} type - The type of media (movie or tv).
 * @param {boolean} [countOnly=false] - If true, returns only the count of records.
 * @param {number} [page=1] - The page number for pagination (1-based).
 * @param {number} [limit=0] - The number of items per page.
 * @param {object} [customProjection={}] - Optional custom projection object to merge with default.
 * @returns {Promise} Resolves to an array of poster objects or the count of records.
 */
export async function getFlatPosters(type, countOnly = false, page = 1, limit = 15, customProjection = {}) {
  const client = await clientPromise
  const collection = type === 'movie' ? 'FlatMovies' : 'FlatTVShows'

  // Define default projections for fields to include
  const defaultProjection = {
    _id: 1,
    title: 1,
    posterURL: 1,
    posterBlurhash: 1,
    backdrop: 1,
    backdropBlurhash: 1,
    metadata: 1,
  }
  if (type === 'movie') {
    defaultProjection.hdr = 1
    defaultProjection.videoURL = 1
  }

  // Merge default projection with custom projection
  const finalProjection = { ...defaultProjection, ...customProjection };
  
  if (countOnly) {
    return await client.db('Media').collection(collection).countDocuments()
  }

  // Ensure page is at least 1 for 1-based pagination
  const skip = page * limit
  const queryOptions = { projection: finalProjection } // Use the merged projection
  if (limit > 0) {
    queryOptions.limit = limit
    queryOptions.skip = skip
  }

  const records = await client
    .db('Media')
    .collection(collection)
    .find({}, queryOptions)
    .toArray()

  return await Promise.all(
    records.map(async (record) => {
      let poster =
        record.posterURL ||
        getFullImageUrl(record.metadata?.poster_path) ||
        `/sorry-image-not-available.jpg`
      
      if (!poster) {
        poster = null
      }

      if (record._id) {
        record._id = record._id.toString()
      }

      const returnData = {
        ...record,
        posterURL: poster,
        link: encodeURIComponent(record.title) || null,
        type: type,
        //media: record
      }

      return returnData
    })
  )
}

/**
 * Add custom URL and other fields to media items from flat structure.
 *
 * @param {Array} mediaArray - Array of media objects.
 * @param {string} type - Media type ('movie' or 'tv').
 * @returns {Promise<Array>} Media array with custom URLs added.
 */
export async function addCustomUrlToFlatMedia(mediaArray, type) {
  return await Promise.all(
    mediaArray.map(async (media) => {
      const id = media._id.toString()
      delete media._id
      let returnObj = {
        ...media,
        id: id,
        url: `/list/${type}/${encodeURIComponent(media.title)}`,
        link: encodeURIComponent(media.title) || null,
        description: media.metadata?.overview,
        type,
      }
      
      // For TV episodes, use the episode thumbnail as the poster if available
      if (type === 'tv' && media.episode && media.episode.thumbnail) {
        returnObj.posterURL = media.episode.thumbnail;
        returnObj.thumbnail = media.episode.thumbnail;
        
        // Preserve episode's raw thumbnail blurhash data for later processing
        if (media.episode.thumbnailBlurhash) {
          returnObj.thumbnailBlurhash = media.episode.thumbnailBlurhash;
          returnObj.thumbnailBlurhashSource = media.episode.thumbnailBlurhashSource;
          // Also use thumbnail blurhash as poster blurhash (keeping them raw)
          returnObj.posterBlurhash = media.episode.thumbnailBlurhash;
          returnObj.posterBlurhashSource = media.episode.thumbnailBlurhashSource;
        }
      } 
      // Standard poster handling for non-episode media
      else if (!media.posterURL) {
        returnObj.posterURL = media.metadata?.poster_path
          ? getFullImageUrl(media.metadata.poster_path, 'w780')
          : `/sorry-image-not-available.jpg`
      }
      
      // Preserve poster blurhash raw data (no fetching)
      if (!returnObj.posterBlurhash && media.posterBlurhash) {
        returnObj.posterBlurhash = media.posterBlurhash;
        returnObj.posterBlurhashSource = media.posterBlurhashSource;
      }
      
      // Preserve backdrop blurhash raw data (no fetching)
      if (media.backdropBlurhash) {
        returnObj.backdropBlurhash = media.backdropBlurhash;
        returnObj.backdropBlurhashSource = media.backdropBlurhashSource;
        returnObj.backdropSource = media.backdropSource;
      }
      
      // Make sure backdrop is set if it exists in metadata
      if (!returnObj.backdrop && media.metadata?.backdrop_path) {
        returnObj.backdrop = getFullImageUrl(media.metadata.backdrop_path, 'original')
      }
      
      return returnObj
    })
  )
}

/**
 * Get the most recently watched media for the current user from flat database structure.
 *
 * @param {Object} params - Parameters for the function.
 * @param {string} params.userId - The ID of the current user.
 * @param {number} [params.page=0] - The page number for pagination (0-based).
 * @param {number} [params.limit=15] - The number of items per page.
 * @param {boolean} [params.countOnly=false] - Whether to only get the document count.
 * @returns {Promise<Array|number>} The recently watched media details or the document count.
 */
export async function getFlatRecentlyWatchedForUser({
  userId,
  page = 0,
  limit = 15,
  countOnly = false,
}) {
  try {
    if (Boolean(process.env.DEBUG) == true) {
      console.time('getFlatRecentlyWatchedForUser:total');
      console.log(`[PERF] Starting getFlatRecentlyWatchedForUser for userId: ${userId}, page: ${page}, limit: ${limit}, countOnly: ${countOnly}`);
      console.time('getFlatRecentlyWatchedForUser:findUser');
    }
    
    const client = await clientPromise;
    const user = await client
      .db('Users')
      .collection('AuthenticatedUsers')
      .findOne({ _id: new ObjectId(userId) }, { projection: { _id: 1 } });
      
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('getFlatRecentlyWatchedForUser:findUser');
    }

    if (!user) {
      throw new Error(`User with ID ${userId} not found`);
    }

    const validPage = Math.max(page, 0); // Ensure page is at least 0
    
    // Get the user's watch history
    if (Boolean(process.env.DEBUG) == true) {
      console.time('getFlatRecentlyWatchedForUser:fetchWatchHistory');
    }
    
    const userPlayback = await client
      .db('Media')
      .collection('PlaybackStatus')
      .findOne({ userId: user._id }, { projection: { videosWatched: 1 } });
      
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('getFlatRecentlyWatchedForUser:fetchWatchHistory');
    }

    if (!userPlayback || !userPlayback.videosWatched || userPlayback.videosWatched.length === 0) {
      if (Boolean(process.env.DEBUG) == true) {
        console.log('[PERF] No watch history found');
        console.timeEnd('getFlatRecentlyWatchedForUser:total');
      }
      return countOnly ? 0 : null;
    }
    
    if (Boolean(process.env.DEBUG) == true) {
      console.log(`[PERF] Total videos in watch history: ${userPlayback.videosWatched.length}`);
      console.time('getFlatRecentlyWatchedForUser:filterValidVideos');
    }
    
    // Filter valid videos in memory
    const validVideos = userPlayback.videosWatched.filter(video => 
      video.isValid === undefined || video.isValid === true
    );
    
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('getFlatRecentlyWatchedForUser:filterValidVideos');
      console.log(`[PERF] Valid videos after filtering: ${validVideos.length}`);
    }
    
    if (validVideos.length === 0) {
      if (Boolean(process.env.DEBUG) == true) {
        console.timeEnd('getFlatRecentlyWatchedForUser:total');
      }
      return countOnly ? 0 : null;
    }
    
    // Extract video IDs
    const videoIds = validVideos.map(video => video.videoId);
    const uniqueVideoIds = [...new Set(videoIds)]; // Ensure uniqueness
    
    if (Boolean(process.env.DEBUG) == true) {
      console.log(`[PERF] Unique video IDs: ${uniqueVideoIds.length}`);
    }
    
    // Define projections to limit the fields returned
    const movieProjection = {
      _id: 1,
      title: 1,
      videoURL: 1,
      posterURL: 1,
      posterBlurhash: 1,
      posterBlurhashSource: 1,
      backdrop: 1,
      backdropBlurhash: 1,
      backdropBlurhashSource: 1,
      hdr: 1,
      length: 1,
      metadata: 1,
    };
    
    // Bulk fetch movies and episodes from flat database
    if (Boolean(process.env.DEBUG) == true) {
      console.time('getFlatRecentlyWatchedForUser:fetchMediaData');
    }
    
    const [movies, episodes] = await Promise.all([
      client
        .db('Media')
        .collection('FlatMovies')
        .find({ videoURL: { $in: uniqueVideoIds } }, { projection: movieProjection })
        .toArray(),
      client
        .db('Media')
        .collection('FlatEpisodes')
        .find({ videoURL: { $in: uniqueVideoIds } })
        .toArray()
    ]);
    
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('getFlatRecentlyWatchedForUser:fetchMediaData');
      console.log(`[PERF] Found ${movies.length} movies and ${episodes.length} episodes`);
      console.time('getFlatRecentlyWatchedForUser:createLookupMaps');
    }
    
    // Create maps for efficient lookups
    const movieMap = new Map(movies.map(movie => [movie.videoURL, movie]));
    const episodeMap = new Map();
    
    // For each episode, fetch its season and show
    await Promise.all(episodes.map(async (episode) => {
      const season = await client
        .db('Media')
        .collection('FlatSeasons')
        .findOne({ _id: episode.seasonId });
        
      if (!season) return;
      
      const show = await client
        .db('Media')
        .collection('FlatTVShows')
        .findOne({ _id: episode.showId });
        
      if (!show) return;
      
      // Create a simplified TV show structure with this episode
      episodeMap.set(episode.videoURL, { 
        ...show, 
        episode,
        seasons: [{ 
          ...season,
          episodes: [episode]
        }]
      });
    }));
    
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('getFlatRecentlyWatchedForUser:createLookupMaps');
      console.log(`[PERF] Created lookup maps - Movies: ${movieMap.size}, Episodes: ${episodeMap.size}`);
      console.time('getFlatRecentlyWatchedForUser:filterAndSort');
    }
    
    // Filter out videos that don't exist in the database
    const validVideoIds = new Set([
      ...movieMap.keys(),
      ...episodeMap.keys()
    ]);
    
    const filteredVideos = validVideos.filter(video => 
      validVideoIds.has(video.videoId)
    );
    
    if (Boolean(process.env.DEBUG) == true) {
      console.log(`[PERF] Videos after filtering for existence in DB: ${filteredVideos.length}`);
    }

    // If count only, return the count
    if (countOnly) {
      if (Boolean(process.env.DEBUG) == true) {
        console.timeEnd('getFlatRecentlyWatchedForUser:filterAndSort');
        console.timeEnd('getFlatRecentlyWatchedForUser:total');
      }
      return filteredVideos.length;
    }
    
    // Sort by lastUpdated (most recent first)
    filteredVideos.sort((a, b) => {
      const dateA = a.lastUpdated ? new Date(a.lastUpdated) : new Date(0);
      const dateB = b.lastUpdated ? new Date(b.lastUpdated) : new Date(0);
      return dateB - dateA;
    });
    
    // Apply pagination
    const paginatedVideos = filteredVideos.slice(
      validPage * limit, 
      (validPage + 1) * limit
    );
    
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('getFlatRecentlyWatchedForUser:filterAndSort');
      console.log(`[PERF] Videos after pagination: ${paginatedVideos.length}`);
    }
    
    // Create a mock lastWatched object to match the expected format for processWatchedDetails
    const lastWatched = [{
      _id: userId,
      videosWatched: paginatedVideos
    }];
    
    // Process the watched details
    if (Boolean(process.env.DEBUG) == true) {
      console.time('getFlatRecentlyWatchedForUser:processWatchedDetails');
    }
    
    // Pass along the context object 
    const contextObj = { dateContext: 'watchHistory' };
    const watchedDetails = await processWatchedDetails(
      lastWatched, 
      movieMap, 
      episodeMap, 
      limit,
      contextObj
    );
    
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('getFlatRecentlyWatchedForUser:processWatchedDetails');
      console.log(`[PERF] Final processed watched details count: ${watchedDetails ? watchedDetails.length : 0}`);
      console.timeEnd('getFlatRecentlyWatchedForUser:total');
    }
    
    return watchedDetails;
  } catch (error) {
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('getFlatRecentlyWatchedForUser:total');
    }
    console.error(`Error in getFlatRecentlyWatchedForUser: ${error.message}`);
    throw error;
  }
}

/**
 * Get recently added media from flat database structure.
 *
 * @param {Object} params - Parameters for the function.
 * @param {number} [params.page=0] - The page number for pagination (0-based).
 * @param {number} [params.limit=12] - The number of items per page.
 * @param {boolean} [params.countOnly=false] - Whether to only get the document count.
 * @returns {Promise<Array|number>} Recently added media or count.
 */
export async function getFlatRecentlyAddedMedia({ page = 0, limit = 15, countOnly = false }) {
  try {
    const client = await clientPromise
    const db = client.db('Media')

    // Define projection fields for flat movies
    const movieProjectionFields = {
      _id: 1,
      title: 1,
      metadata: 1,
      posterURL: 1,
      posterBlurhash: 1,
      backdrop: 1,
      backdropBlurhash: 1,
      hdr: 1,
      mediaLastModified: 1,
      posterBlurhashSource: 1,
      backdropBlurhashSource: 1,
      posterSource: 1,
      backdropSource: 1 
    }

    // For non-count queries, get a larger pool of items to combine and paginate
    const poolSize = limit * 20; // Get more items to ensure we have enough after combination/sorting

    // Get most recently added movies
    const movies = await db
      .collection('FlatMovies')
      .find({}, { projection: movieProjectionFields })
      .sort({ mediaLastModified: -1 })
      .limit(poolSize)
      .toArray()

    // Get most recently added TV shows or episodes
    // First get the most recent episodes
    const recentEpisodes = await db
      .collection('FlatEpisodes')
      .aggregate([
        { $sort: { mediaLastModified: -1 } },
        { $limit: poolSize * 2 }, // Get more than needed to account for grouping
        {
          $group: {
            _id: "$showId",
            showId: { $first: "$showId" },
            episodeId: { $first: "$_id" },
            mediaLastModified: { $max: "$mediaLastModified" }
          }
        },
        { $sort: { mediaLastModified: -1 } },
        { $limit: poolSize }
      ])
      .toArray()

    // Get the corresponding TV shows
    const tvShows = await Promise.all(
      recentEpisodes.map(async (item) => {
        const show = await db
          .collection('FlatTVShows')
          .findOne({ _id: item.showId })
        
        if (show) {
          show.mediaLastModified = item.mediaLastModified
        }
        
        return show
      })
    ).then(shows => shows.filter(Boolean)) // Remove null values

    if (countOnly) {
      // For "recently added", we cap the total items at a reasonable limit
      // This prevents too many pagination buttons from being shown
      const MAX_RECENTLY_ADDED_ITEMS = 100; // Cap at 100 items total
      
      // Get counts but with reasonable limits
      const [moviesCount, episodeGroupsCount] = await Promise.all([
        // Get count of movies, but no more than half our maximum
        db.collection('FlatMovies')
          .find({})
          .sort({ mediaLastModified: -1 })
          .limit(MAX_RECENTLY_ADDED_ITEMS / 2)
          .count(),
          
        // Get count of unique TV shows with recent episodes, but no more than half our maximum
        db.collection('FlatEpisodes')
          .aggregate([
            { $sort: { mediaLastModified: -1 } },
            { $limit: 1000 }, // Look at the 1000 most recent episodes
            { $group: { _id: "$showId" } },
            { $count: "total" }
          ])
          .toArray()
          .then(res => Math.min(res[0]?.total || 0, MAX_RECENTLY_ADDED_ITEMS / 2))
      ]);
      
      // Return the sum, but never more than our maximum
      return Math.min(moviesCount + episodeGroupsCount, MAX_RECENTLY_ADDED_ITEMS);
    }

    // Add URLs to media
    const [moviesWithUrl, tvShowsWithUrl] = await Promise.all([
      addCustomUrlToFlatMedia(movies, 'movie'),
      addCustomUrlToFlatMedia(tvShows, 'tv'),
    ])

    // Arrange media by latest modification
    const arrangedMedia = arrangeMediaByLatestModification(moviesWithUrl, tvShowsWithUrl)

    // Apply pagination to the combined and arranged result
    // This ensures we maintain consistent pagination across all pages
    const validPage = Math.max(page, 0); // Ensure page is at least 0
    const startIndex = validPage * limit;
    const endIndex = startIndex + limit;
    
    // If we're requesting a page beyond what we have data for, return empty array
    if (startIndex >= arrangedMedia.length) {
      return [];
    }
    
    // Get just the items for this page
    const paginatedMedia = arrangedMedia.slice(startIndex, endIndex);
    
    // Sanitize each item using the flexible sanitizeRecord function with appropriate context
    const contextObj = { dateContext: 'recentlyAdded' };
    const sanitizedMedia = await Promise.all(
      paginatedMedia.map(async (media) => 
        // Use the flexible sanitizeRecord function with context
        sanitizeRecord(media, media.type, contextObj)
      )
    );
    
    return sanitizedMedia;
  } catch (error) {
    console.error(`Error in getFlatRecentlyAddedMedia: ${error.message}`)
    throw error
  }
}

/**
 * Fetch the latest movies for the banner from the flat database structure.
 * 
 * @returns {Promise<Array|Object>} An array of the latest 8 movie objects or an error object.
 */
export const fetchFlatBannerMedia = async () => {
  try {
    const client = await clientPromise;
    const db = client.db('Media');
    
    const media = await db
      .collection('FlatMovies') // Use FlatMovies collection
      .find({})
      .sort({ 'metadata.release_date': -1 }) // Sort by release date descending
      .limit(8) // Limit to 8 movies
      .toArray();

    if (!media || media.length === 0) {
      return { error: 'No media found for banner', status: 404 };
    }

    // Process items: ensure backdrop URL and remove _id
    const processedMedia = media.map(item => {
      const processedItem = { ...item }; // Clone item
      if (processedItem && !processedItem.backdrop && processedItem.metadata?.backdrop_path) {
        processedItem.backdrop = getFullImageUrl(processedItem.metadata.backdrop_path, 'original');
      }
      if (processedItem && processedItem._id) {
        processedItem.id = processedItem._id.toString(); // Add string id
        delete processedItem._id; // Remove ObjectId
      }
      return processedItem;
    });

    return processedMedia; // Return the array of processed media objects
  } catch (error) {
    console.error(`Error in fetchFlatBannerMedia: ${error.message}`);
    return { error: 'Failed to fetch banner media', details: error.message, status: 500 };
  }
};


/**
 * Fetch a random banner media from flat database structure.
 * 
 * @returns {Promise<Object>} A randomly selected banner media.
 */
export const fetchFlatRandomBannerMedia = async () => {
  try {
    const client = await clientPromise
    const db = client.db('Media')
    
    // Randomly choose between Movies and TV collections
    const collections = ['FlatMovies', 'FlatTVShows']
    const randomCollection = collections[Math.floor(Math.random() * collections.length)]
    
    const media = await db
      .collection(randomCollection)
      .aggregate([
        { $sample: { size: 1 } }
      ])
      .toArray()

    if (!media || media.length === 0) {
      return { error: 'No media found', status: 404 }
    }

    // Fetch metadata for backdropBlurhash if available
    const item = media[0]
    if (item && !item.backdrop) {
      item.backdrop = getFullImageUrl(item.metadata.backdrop_path, 'original')
    }
    if (item && item._id) {
      delete item._id
    }

    return item // Return single media object
  } catch (error) {
    return { error: 'Failed to fetch media', status: 500 }
  }
}

/**
 * Gets requested media from the flat database structure.
 * This function is a replacement for getRequestedMedia but uses the flat database collections.
 *
 * @param {Object} params - Parameters for fetching media.
 * @param {string} params.type - The type of media (movie or tv).
 * @param {string} [params.title] - The title of the media.
 * @param {string} [params.id] - The ID of the media (alternative to title).
 * @param {string} [params.season] - The season number (for TV shows).
 * @param {string} [params.episode] - The episode number (for TV shows with season).
 * @returns {Promise<Object|null>} The requested media or null if not found.
 */
export async function getFlatRequestedMedia({
  type,
  title = null,
  season = null,
  episode = null,
  id = null,
}) {
  try {
    if (Boolean(process.env.DEBUG) == true) {
      console.time('getFlatRequestedMedia:total');
      console.log(`[PERF] Fetching ${type} media: title=${title}, id=${id}, season=${season}, episode=${episode}`);
    }
    
    const client = await clientPromise;
    const db = client.db('Media');
    
    if (type === 'movie') {
      if (Boolean(process.env.DEBUG) == true) {
        console.time('getFlatRequestedMedia:fetchMovie');
      }
      
      // Build query
      const query = {};
      if (title) query.title = title;
      if (id) query._id = new ObjectId(id);
      
      if (!title && !id) {
        if (Boolean(process.env.DEBUG) == true) {
          console.timeEnd('getFlatRequestedMedia:total');
        }
        return null;
      }
      
      // Fetch movie
      const movie = await db.collection('FlatMovies').findOne(query);
      
      if (!movie) {
        if (Boolean(process.env.DEBUG) == true) {
          console.timeEnd('getFlatRequestedMedia:fetchMovie');
          console.timeEnd('getFlatRequestedMedia:total');
        }
        return null;
      }
      
      // Convert _id to string id
      const result = {
        ...movie,
        id: movie._id.toString(),
        type: 'movie'
      };
      delete result._id;
      
      // Add cast data if available
      if (result.metadata?.cast) {
        result.cast = result.metadata.cast;
      }
      
      if (Boolean(process.env.DEBUG) == true) {
        console.timeEnd('getFlatRequestedMedia:fetchMovie');
        console.timeEnd('getFlatRequestedMedia:total');
      }
      
      return result;
    } 
    else if (type === 'tv') {
      if (Boolean(process.env.DEBUG) == true) {
        console.time('getFlatRequestedMedia:fetchTV');
      }
      
      // Build query
      const query = {};
      if (title) query.title = title;
      if (id) query._id = new ObjectId(id);
      
      if (!title && !id) {
        if (Boolean(process.env.DEBUG) == true) {
          console.timeEnd('getFlatRequestedMedia:total');
        }
        return null;
      }
      
      // Fetch TV show
      const tvShow = await db.collection('FlatTVShows').findOne(query);
      
      if (!tvShow) {
        if (Boolean(process.env.DEBUG) == true) {
          console.timeEnd('getFlatRequestedMedia:fetchTV');
          console.timeEnd('getFlatRequestedMedia:total');
        }
        return null;
      }
      
      // Basic TV show data (no season/episode specified)
      if (!season) {
        // Get all seasons for this show
        const seasons = await db.collection('FlatSeasons')
          .find({ showId: tvShow._id })
          .sort({ seasonNumber: 1 })
          .toArray();
          
        // Convert _id to string id
        const result = {
          ...tvShow,
          _id: tvShow._id.toString(),
          type: 'tv',
          seasons: seasons.map(season => ({
            ...season,
            _id: season._id.toString(),
            showId: season.showId.toString(),
            seasonNumber: season.seasonNumber,
          }))
        };
        
        // Add cast data if available
        if (result.metadata?.cast) {
          // Collect all guest stars from episodes
          const compiledGuestStarsMap = new Map();
          
          // First fetch all episodes with guest stars
          const episodes = await db.collection('FlatEpisodes')
            .find({ 
              showId: new ObjectId(result.id),
              'metadata.guest_stars': { $exists: true, $ne: [] }
            })
            .project({ 'metadata.guest_stars': 1 })
            .toArray();
            
          // Process guest stars
          episodes.forEach(episode => {
            if (episode.metadata?.guest_stars) {
              episode.metadata.guest_stars.forEach(castMember => {
                if (!compiledGuestStarsMap.has(castMember.id)) {
                  compiledGuestStarsMap.set(castMember.id, castMember);
                }
              });
            }
          });
          
          // Combine the main cast with the unique guest stars
          const uniqueGuestStars = Array.from(compiledGuestStarsMap.values());
          result.cast = [
            ...(result.metadata.cast || []),
            ...uniqueGuestStars
          ];
          
          // Ensure all cast members are unique based on ID
          const uniqueCastMap = new Map();
          result.cast.forEach(castMember => {
            if (!uniqueCastMap.has(castMember.id)) {
              uniqueCastMap.set(castMember.id, castMember);
            }
          });
          result.cast = Array.from(uniqueCastMap.values());
        }
        
        if (Boolean(process.env.DEBUG) == true) {
          console.timeEnd('getFlatRequestedMedia:fetchTV');
          console.timeEnd('getFlatRequestedMedia:total');
        }
        
        return result;
      } 
      // Season specified
      else {
        const seasonNumber = parseInt(season.replace('Season ', ''));
        const seasonData = await db.collection('FlatSeasons').findOne({ 
          showId: tvShow._id,
          seasonNumber: seasonNumber
        });
        
        if (!seasonData) {
          if (Boolean(process.env.DEBUG) == true) {
            console.timeEnd('getFlatRequestedMedia:fetchTV');
            console.timeEnd('getFlatRequestedMedia:total');
          }
          return null;
        }
        
        // Just season (no episode)
        if (!episode) {
          const result = {
            ...seasonData,
            id: seasonData._id.toString(),
            showId: seasonData.showId.toString(),
            title: tvShow.title,
            originalTitle: tvShow.originalTitle,
            type: 'tv',
            metadata: {
              ...(seasonData.metadata || {}),
              tvOverview: tvShow.metadata?.overview,
              trailer_url: tvShow.metadata?.trailer_url
            },
            posterURL: seasonData.posterURL || tvShow.posterURL || getFullImageUrl(tvShow.metadata?.poster_path)
          };
          delete result._id;
          
          if (Boolean(process.env.DEBUG) == true) {
            console.timeEnd('getFlatRequestedMedia:fetchTV');
            console.timeEnd('getFlatRequestedMedia:total');
          }
          
          return result;
        } 
        // Episode specified
        else {
          const episodeNumber = parseInt(episode.replace('Episode ', ''));
          const episodeData = await db.collection('FlatEpisodes').findOne({
            showId: tvShow._id,
            seasonId: seasonData._id,
            episodeNumber: episodeNumber
          });
          
          if (!episodeData) {
            if (Boolean(process.env.DEBUG) == true) {
              console.timeEnd('getFlatRequestedMedia:fetchTV');
              console.timeEnd('getFlatRequestedMedia:total');
            }
            return null;
          }
          
          // Get next episode (if available)
          const nextEpisode = await db.collection('FlatEpisodes').findOne({
            showId: tvShow._id,
            seasonId: seasonData._id,
            episodeNumber: { $gt: episodeNumber }
          }, { 
            sort: { episodeNumber: 1 },
            projection: { 
              _id: 1, 
              episodeNumber: 1, 
              title: 1, 
              thumbnail: 1,
              metadata: 1
            }
          });
          
          const result = {
            ...episodeData,
            id: episodeData._id.toString(),
            showId: episodeData.showId.toString(),
            seasonId: episodeData.seasonId.toString(),
            title: episodeData.title, // Use episode title
            originalTitle: tvShow.originalTitle,
            logo: tvShow.logo,
            seasonNumber: seasonNumber,
            episodeNumber: episodeNumber,
            type: 'tv',
            posterURL: seasonData.posterURL || tvShow.posterURL || getFullImageUrl(tvShow.metadata?.poster_path),
            posterBlurhash: seasonData.posterBlurhash || tvShow.posterBlurhash || null,
            // Add episode's thumbnail as both thumbnail and backdrop
            thumbnail: episodeData.thumbnail || null,
            thumbnailSource: episodeData.thumbnailSource || null,
            thumbnailBlurhash: episodeData.thumbnailBlurhash || null,
            thumbnailBlurhashSource: episodeData.thumbnailBlurhashSource || null,
            // Set backdrop from thumbnail or show backdrop
            backdrop: episodeData.thumbnail || tvShow.backdrop,
            backdropSource: episodeData.thumbnailSource || tvShow.backdropSource,
            backdropBlurhash: episodeData.thumbnailBlurhash || tvShow.backdropBlurhash,
            backdropBlurhashSource: episodeData.thumbnailBlurhashSource || tvShow.backdropBlurhashSource,
            metadata: {
              ...(episodeData.metadata || {}),
              backdrop_path: episodeData.metadata?.backdrop_path || tvShow.metadata?.backdrop_path,
              rating: tvShow.metadata?.rating || null,
              trailer_url: tvShow.metadata?.trailer_url || null
            }
          };
          delete result._id;
          
          // Handle next episode info
          if (nextEpisode) {
            result.hasNextEpisode = true;
            result.nextEpisodeThumbnail = nextEpisode.thumbnail || nextEpisode.metadata?.still_path || null;
            result.nextEpisodeTitle = nextEpisode.title || nextEpisode.metadata?.name || null;
            result.nextEpisodeNumber = nextEpisode.episodeNumber;
          } else {
            result.hasNextEpisode = false;
          }
          
          // Handle cast data
          if (tvShow.metadata?.cast) {
            const guestStars = episodeData.metadata?.guest_stars || [];
            const mainCast = tvShow.metadata.cast || [];
            
            // Create a map of guest stars for quick lookup
            const guestStarsMap = new Map(guestStars.map(star => [star.id, star]));
            
            // Filter out guest stars from the main cast
            const filteredMainCast = mainCast.filter(castMember => !guestStarsMap.has(castMember.id));
            
            // Combine filtered main cast with guest stars
            result.cast = [
              ...filteredMainCast,
              ...guestStars
            ];
          }
          
          if (Boolean(process.env.DEBUG) == true) {
            console.timeEnd('getFlatRequestedMedia:fetchTV');
            console.timeEnd('getFlatRequestedMedia:total');
          }
          
          return result;
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error(`Error in getFlatRequestedMedia: ${error.message}`);
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('getFlatRequestedMedia:total');
    }
    throw error;
  }
}

// Helper function to get trailer media
export async function getTrailerMedia(type, title) {
  // Get the media and extract trailer information
  const media = await getFlatRequestedMedia({
    type: type,
    title: decodeURIComponent(title),
  });

  if (media && media.metadata?.trailer_url) {
    // Create a new object with just the trailer information
    return {
      ...media,
      videoURL: media.metadata.trailer_url,
      isTrailer: true
    };
  }
  
  return null;
}

// Function to get the count of available movies in the flat database
export async function getFlatAvailableMoviesCount() {
  try {
    const client = await clientPromise;
    return await client.db('Media').collection('FlatMovies').countDocuments();
  } catch (error) {
    console.error('Error fetching movie count:', error);
    return 0;
  }
}

// Function to get the last updated timestamp for movies in the flat database
export async function getFlatMoviesLastUpdatedTimestamp() {
  try {
    const client = await clientPromise;
    const result = await client
      .db('Media')
      .collection('FlatMovies')
      .find({})
      .sort({ mediaLastModified: -1 })
      .limit(1)
      .toArray();
    
    return result.length > 0 && result[0].mediaLastModified 
      ? new Date(result[0].mediaLastModified).getTime() 
      : Date.now();
  } catch (error) {
    console.error('Error fetching last updated timestamp:', error);
    return Date.now();
  }
}

/**
 * Gets all TV shows for the TV list page using the flat database structure.
 * This function is optimized for the TVList component with minimal projection fields.
 *
 * @param {Object} [options] - Optional parameters
 * @param {number} [options.limit=0] - Optional limit for number of records to return (0 = no limit)
 * @param {boolean} [options.sort=true] - Whether to sort by last air date
 * @returns {Promise<Array>} Array of TV shows with fields needed by the TVList component
 */
export async function getFlatTVList(options = {}) {
  const { limit = 0, sort = true } = options;
  
  try {
    const client = await clientPromise;
    
    // Define minimal projection for TV list view
    const projection = {
      _id: 1,
      title: 1,
      posterURL: 1,
      posterBlurhash: 1,
      posterBlurhashSource: 1,
      metadata: 1
    };
    
    // Setup query options
    const queryOptions = { projection };
    if (limit > 0) {
      queryOptions.limit = limit;
    }
    
    // Fetch TV shows from flat database
    let tvShows = await client
      .db('Media')
      .collection('FlatTVShows')
      .find({}, queryOptions)
      .toArray();
      
    // Sort by last air date if requested
    if (sort) {
      tvShows.sort((a, b) => {
        const dateA = new Date(a.metadata?.last_air_date || 0);
        const dateB = new Date(b.metadata?.last_air_date || 0);
        return dateB - dateA; // Descending order (newest first)
      });
    }
    
    // Process TV shows and fetch seasons for each show
    return await Promise.all(
      tvShows.map(async (tvShow) => {
        // Ensure we have a poster URL
        const posterURL = 
          tvShow.posterURL || 
          (tvShow.metadata?.poster_path ? getFullImageUrl(tvShow.metadata.poster_path) : null) ||
          '/sorry-image-not-available.jpg';
        
        // Get show ID as string for queries
        const showId = tvShow._id.toString();
        
        // Fetch all seasons for this TV show
        const seasons = await client
          .db('Media')
          .collection('FlatSeasons')
          .find({ showId: tvShow._id })
          .sort({ seasonNumber: 1 })
          .toArray();
          
        // For each season, create a properly serialized version with episode information
        const seasonsWithEpisodes = await Promise.all(
          seasons.map(async (season) => {
            // Get the season ID as a string for the episode query
            const seasonId = season._id.toString();
            
            // Just get episode count for each season, which is safer for serialization
            const episodeCount = await client
              .db('Media')
              .collection('FlatEpisodes')
              .countDocuments({ seasonId: season._id });
            
            // Get minimal dimension and HDR data for this season's episodes
            // We'll use aggregation to get just the specific fields we need
            const episodeStats = await client
              .db('Media')
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
              .toArray();
              
            // Create our serialized episode objects
            let serializedEpisodes = episodeStats.map(episode => ({
              _id: episode._id.toString(),
              episodeNumber: episode.episodeNumber,
              dimensions: episode.dimensions || '0x0', // Ensure we have a dimension string
              hdr: episode.hdr || false
            }));
            
            // If no episodes were found, create a placeholder array
            if (serializedEpisodes.length === 0) {
              serializedEpisodes = Array(episodeCount).fill({
                dimensions: '0x0',
                hdr: false
              });
            }
            
            // Return a serialized season object with its episodes
            return {
              _id: seasonId,
              seasonNumber: season.seasonNumber,
              title: season.title || null,
              episodes: serializedEpisodes
            };
          })
        );
        
        // Return a fully serialized TV show object
        return {
          _id: showId,
          id: showId,
          title: tvShow.title,
          posterURL: posterURL,
          posterBlurhash: tvShow.posterBlurhash || null,
          metadata: tvShow.metadata || {},
          link: encodeURIComponent(tvShow.title) || null,
          type: 'tv',
          seasons: seasonsWithEpisodes
        };
      })
    );
  } catch (error) {
    console.error(`Error in getFlatTVList: ${error.message}`);
    throw error;
  }
}

/**
 * Get the count of available TV shows in the flat database.
 * 
 * @returns {Promise<number>} The count of TV shows.
 */
export async function getFlatAvailableTVShowsCount() {
  try {
    const client = await clientPromise;
    return await client.db('Media').collection('FlatTVShows').countDocuments();
  } catch (error) {
    console.error('Error fetching TV shows count:', error);
    return 0;
  }
}

/**
 * Get the last updated timestamp for TV shows in the flat database.
 * This function checks both TV shows and episodes to find the most recent update.
 * 
 * @returns {Promise<number>} The timestamp of the most recent update.
 */
export async function getFlatTVShowsLastUpdatedTimestamp() {
  try {
    const client = await clientPromise;
    
    // First, check the latest TV show update
    const tvShowsResult = await client
      .db('Media')
      .collection('FlatTVShows')
      .find({})
      .sort({ mediaLastModified: -1 })
      .limit(1)
      .toArray();
    
    // Then check the latest episode update
    const episodesResult = await client
      .db('Media')
      .collection('FlatEpisodes')
      .find({})
      .sort({ mediaLastModified: -1 })
      .limit(1)
      .toArray();
    
    // Compare both timestamps and return the most recent one
    const tvShowTimestamp = tvShowsResult.length > 0 && tvShowsResult[0].mediaLastModified 
      ? new Date(tvShowsResult[0].mediaLastModified).getTime() 
      : 0;
      
    const episodeTimestamp = episodesResult.length > 0 && episodesResult[0].mediaLastModified 
      ? new Date(episodesResult[0].mediaLastModified).getTime() 
      : 0;
    
    // Return the most recent timestamp or current time if none found
    return Math.max(tvShowTimestamp, episodeTimestamp) || Date.now();
  } catch (error) {
    console.error('Error fetching TV shows last updated timestamp:', error);
    return Date.now();
  }
}

/**
 * Get TV season details with its episodes from the flat database structure.
 * This function is specifically designed for the TVEpisodesListComponent.
 *
 * @param {Object} params - Parameters for fetching the season.
 * @param {string} params.showTitle - The title of the TV show.
 * @param {number} params.seasonNumber - The season number.
 * @returns {Promise<Object|null>} The season with its episodes or null if not found.
 */
export async function getFlatTVSeasonWithEpisodes({ showTitle, seasonNumber }) {
  try {
    if (Boolean(process.env.DEBUG) == true) {
      console.time('getFlatTVSeasonWithEpisodes:total');
    }
    
    const client = await clientPromise;
    const db = client.db('Media');
    
    // First, get the TV show
    const tvShow = await getFlatRequestedMedia({
      type: 'tv',
      title: showTitle
    });
    
    if (!tvShow) {
      if (Boolean(process.env.DEBUG) == true) {
        console.timeEnd('getFlatTVSeasonWithEpisodes:total');
      }
      return null;
    }
    
    // From the TV show, find the requested season to get its ID
    const matchingSeason = tvShow.seasons.find(s => s.seasonNumber === parseInt(seasonNumber));
    
    if (!matchingSeason) {
      if (Boolean(process.env.DEBUG) == true) {
        console.timeEnd('getFlatTVSeasonWithEpisodes:total');
      }
      return null;
    }
    
    // Get the full season details
    const season = await getFlatRequestedMedia({
      type: 'tv',
      title: tvShow.title,
      season: `Season ${seasonNumber}`
    });
    
    if (!season) {
      if (Boolean(process.env.DEBUG) == true) {
        console.timeEnd('getFlatTVSeasonWithEpisodes:total');
      }
      return null;
    }
    
    // Fetch episodes for this season from the flat database
    const episodes = await db.collection('FlatEpisodes')
      .find({ 
        seasonId: new ObjectId(matchingSeason._id)
      })
      .sort({ episodeNumber: 1 })
      .toArray();
    
    if (Boolean(process.env.DEBUG) == true) {
      console.log(`[PERF] Found ${episodes.length} episodes for season ${seasonNumber} of "${showTitle}"`);
    }
    
    // Add episodes to the season object with proper ID conversions
    season.episodes = episodes.map((episode) => {
      const episodeObj = {
        ...episode,
        _id: episode._id.toString(),
        showId: episode.showId.toString(),
        seasonId: episode.seasonId.toString()
      };

      return episodeObj;
    });
    
    // Set basic info about the parent TV show for the component
    season.showTitle = tvShow.title;
    
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('getFlatTVSeasonWithEpisodes:total');
    }
    
    return season;
  } catch (error) {
    console.error(`Error in getFlatTVSeasonWithEpisodes: ${error.message}`);
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('getFlatTVSeasonWithEpisodes:total');
    }
    throw error;
  }
}
