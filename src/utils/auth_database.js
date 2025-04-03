'use server'

import clientPromise from '@src/lib/mongodb'
import { auth } from '../lib/auth'
import { ObjectId } from 'mongodb'
import { fetchMetadataMultiServer } from '@src/utils/admin_utils'
import {
  arrangeMediaByLatestModification,
  movieProjectionFields,
  processWatchedDetails,
  tvShowProjectionFields,
} from '@src/utils/auth_utils'
import { getFullImageUrl } from '@src/utils'

export async function getVideosWatched() {
  const session = await auth()

  if (!session) {
    return null
  }

  const client = await clientPromise
  const db = client.db('Media')
  const data = await db
    .collection('PlaybackStatus')
    .findOne({ userId: new ObjectId(session.user.id) })

  if (data?.videosWatched) {
    return data.videosWatched
  }

  return {}
}

export const fetchBannerMedia = async () => {
  try {
    const client = await clientPromise
    const media = await client
      .db('Media')
      .collection('Movies')
      .find({})
      .sort({ 'metadata.release_date': -1 })
      .limit(8)
      .toArray()

    if (!media || media.length === 0) {
      return { error: 'No media found', status: 404 }
    }

    // Fetch metadata for backdropBlurhash if available
    for (let item of media) {
      if (item && !item.backdrop) {
        item.backdrop = getFullImageUrl(item.metadata.backdrop_path, 'original')
      }
      if (item && item._id) {
        delete item._id
      }
    }

    return media // Return the array of media objects
  } catch (error) {
    return { error: 'Failed to fetch media', details: error.message, status: 500 }
  }
}

export const fetchRandomBannerMedia = async () => {
  try {
    const client = await clientPromise
    const db = client.db('Media')
    
    // Randomly choose between Movies and TV collections
    const collections = ['Movies', 'TV']
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

export async function addCustomUrlToMedia(mediaArray, type) {
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
        media: media,
      }
      if (!media.posterURL) {
        returnObj.posterURL = media.metadata?.poster_path
          ? getFullImageUrl(media.metadata.poster_path, 'w780')
          : `/sorry-image-not-available.jpg`
      }
      if (media.posterBlurhash) {
        returnObj.posterBlurhash = media.posterBlurhash
      }
      if (media.backdropBlurhash) {
        returnObj.backdropBlurhash = media.backdropBlurhash
      }
      return returnObj
    })
  )
}

/**
 * Gets posters for movies or TV shows.
 *
 * @param {string} type - The type of media (movie or TV).
 * @param {boolean} [countOnly=false] - If true, returns only the count of records.
 * @returns {Promise} Resolves to an array of poster objects or the count of records.
 */
export async function getPosters(type, countOnly = false, page = 1, limit = 0) {
  const client = await clientPromise
  const collection = type === 'movie' ? 'Movies' : 'TV'

  let additionalFields = {}

  const projection =
    type === 'movie'
      ? {
          title: 1,
          posterURL: 1,
          posterBlurhash: 1,
          backdrop: 1,
          backdropBlurhash: 1,
          posterSource: 1,
          backdropSource: 1,
          posterBlurhashSource: 1,
          backdropBlurhashSource: 1,
          hdr: 1,
          'metadata.poster_path': 1,
          'metadata.trailer_url': 1,
          'metadata.overview': 1,
        }
      : {
          title: 1,
          posterURL: 1,
          posterBlurhash: 1,
          posterSource: 1,
          backdrop: 1,
          backdropBlurhash: 1,
          backdropSource: 1,
          posterBlurhashSource: 1,
          backdropBlurhashSource: 1,
          'metadata.genres': 1,
          'metadata.networks': 1,
          'metadata.status': 1,
          'metadata.seasons.length': 1,
          'metadata.seasons.overview': 1,
          'metadata.poster_path': 1,
          'metadata.trailer_url': 1,
          'metadata.overview': 1,
          'seasons.seasonNumber': 1,
          'seasons.season_poster': 1,
          'seasons.seasonPosterBlurhash': 1,
          'seasons.seasonPosterBlurhashSource': 1,
        }

  if (countOnly) {
    return await client.db('Media').collection(collection).countDocuments()
  }

  const skip = page * limit
  const queryOptions = { projection }
  if (limit > 0) {
    queryOptions.limit = limit
    queryOptions.skip = skip
  }

  const records = await client
    .db('Media')
    .collection(collection)
    .find({}, queryOptions)
    .hint('_id_')
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
      return {
        id: record._id.toString(),
        posterURL: poster,
        posterBlurhash: record.posterBlurhash || null,
        backdropBlurhashSource: record.backdropBlurhashSource || null,
        posterSource: record.posterSource || null,
        backdrop: record.backdrop || null,
        backdropBlurhash: record.backdropBlurhash || null,
        title: record.title || null,
        link: encodeURIComponent(record.title) || null,
        type: type,
        metadata: record.metadata || null,
        media: record,
        ...additionalFields
      }
    })
  )
}

/**
 * Get the most recently watched media for the current user.
 *
 * @param {string} userId - The ID of the current user.
 * @param {number} [page=0] - The page number for pagination (0-based).
 * @param {number} [limit=15] - The number of items per page.
 * @param {boolean} [countOnly=false] - Whether to only get the document count.
 * @returns {Promise<Array|number>} The recently watched media details or the document count.
 */
export async function getRecentlyWatchedForUser({
  userId,
  page = 0,
  limit = 15,
  countOnly = false,
}) {
  try {
    if (Boolean(process.env.DEBUG) == true) {
      console.time('getRecentlyWatchedForUser:total');
      console.log(`[PERF] Starting getRecentlyWatchedForUser for userId: ${userId}, page: ${page}, limit: ${limit}, countOnly: ${countOnly}`);
    
      console.time('getRecentlyWatchedForUser:findUser');
    }
    
    const client = await clientPromise;
    const user = await client
      .db('Users')
      .collection('AuthenticatedUsers')
      .findOne({ _id: new ObjectId(userId) }, { projection: { _id: 1 } }); // Only fetch the _id field
      if (Boolean(process.env.DEBUG) == true) {
        console.timeEnd('getRecentlyWatchedForUser:findUser');
      }

    if (!user) {
      throw new Error(`User with ID ${userId} not found`);
    }

    const validPage = Math.max(page, 0); // Ensure page is at least 0
    
    // Get the user's watch history first - this is more efficient than doing it in the aggregation
    if (Boolean(process.env.DEBUG) == true) {
      console.time('getRecentlyWatchedForUser:fetchWatchHistory');
    }
    const userPlayback = await client
      .db('Media')
      .collection('PlaybackStatus')
      .findOne({ userId: user._id }, { projection: { videosWatched: 1 } }); // Only fetch the videosWatched field
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('getRecentlyWatchedForUser:fetchWatchHistory');
    }

    if (!userPlayback || !userPlayback.videosWatched || userPlayback.videosWatched.length === 0) {
      if (Boolean(process.env.DEBUG) == true) {
        console.log('[PERF] No watch history found');
        console.timeEnd('getRecentlyWatchedForUser:total');
      }
      return countOnly ? 0 : null;
    }
    if (Boolean(process.env.DEBUG) == true) {
      console.log(`[PERF] Total videos in watch history: ${userPlayback.videosWatched.length}`);
      console.time('getRecentlyWatchedForUser:filterValidVideos');
    }
    
    // Filter valid videos in memory - more efficient than doing it in the aggregation
    const validVideos = userPlayback.videosWatched.filter(video => 
      video.isValid === undefined || video.isValid === true
    );
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('getRecentlyWatchedForUser:filterValidVideos');
    
      console.log(`[PERF] Valid videos after filtering: ${validVideos.length}`);
    }
    
    if (validVideos.length === 0) {
      if (Boolean(process.env.DEBUG) == true) {
        console.timeEnd('getRecentlyWatchedForUser:total');
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
      'metadata.poster_path': 1,
      'metadata.backdrop_path': 1,
      'metadata.logo_path': 1,
      'metadata.title': 1
    };
    
    const tvProjection = {
      _id: 1,
      title: 1,
      seasons: 1,
      backdrop: 1,
      backdropBlurhash: 1,
      backdropBlurhashSource: 1,
      posterBlurhash: 1,
      posterBlurhashSource: 1,
      logo: 1,
      metadata: 1
    };
    
    // Bulk fetch movies and TV shows that match these video IDs with limited fields
    if (Boolean(process.env.DEBUG) == true) {
      console.time('getRecentlyWatchedForUser:fetchMediaData');
    }
    const [movies, tvShows] = await Promise.all([
      client
        .db('Media')
        .collection('Movies')
        .find({ videoURL: { $in: uniqueVideoIds } }, { projection: movieProjection })
        .hint("video_lookup") // Use index on videoURL if available
        .toArray(),
      client
        .db('Media')
        .collection('TV')
        .aggregate([
          { $match: { "seasons.episodes.videoURL": { $in: uniqueVideoIds } } },
          { $project: tvProjection },
          { $addFields: { matchedEpisodes: { $filter: {
            input: { $reduce: {
              input: "$seasons",
              initialValue: [],
              in: { $concatArrays: ["$$value", "$$this.episodes"] }
            }},
            as: "episode",
            cond: { $in: ["$$episode.videoURL", uniqueVideoIds] }
          }}}},
          { $match: { "matchedEpisodes.0": { $exists: true } } }
        ], {
          hint: "episode_lookup" // Use episode_lookup index
        }).toArray()
    ]);
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('getRecentlyWatchedForUser:fetchMediaData');
    
      console.log(`[PERF] Found ${movies.length} movies and ${tvShows.length} TV shows`);
      console.time('getRecentlyWatchedForUser:createLookupMaps');
    }
    
    // Create maps for efficient lookups
    const movieMap = new Map(movies.map(movie => [movie.videoURL, movie]));
    const tvMap = new Map();
    
    tvShows.forEach(tvShow => {
      tvShow.seasons.forEach(season => {
        season.episodes.forEach(episode => {
          if (uniqueVideoIds.includes(episode.videoURL)) {
            tvMap.set(episode.videoURL, { ...tvShow, episode });
          }
        });
      });
    });
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('getRecentlyWatchedForUser:createLookupMaps');
    
      console.log(`[PERF] Created lookup maps - Movies: ${movieMap.size}, TV: ${tvMap.size}`);
      console.time('getRecentlyWatchedForUser:filterAndSort');
    }    
    // Filter out videos that don't exist in the database
    const validVideoIds = new Set([
      ...movieMap.keys(),
      ...tvMap.keys()
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
        console.timeEnd('getRecentlyWatchedForUser:filterAndSort');
        console.timeEnd('getRecentlyWatchedForUser:total');
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
      console.timeEnd('getRecentlyWatchedForUser:filterAndSort');
      
      console.log(`[PERF] Videos after pagination: ${paginatedVideos.length}`);
    }
    
    // Create a mock lastWatched object to match the expected format for processWatchedDetails
    const lastWatched = [{
      _id: userId,
      videosWatched: paginatedVideos
    }];
    
    // Process the watched details with optimized blurhash handling
    if (Boolean(process.env.DEBUG) == true) {
      console.time('getRecentlyWatchedForUser:processWatchedDetails');
    }
    const watchedDetails = await processWatchedDetails(lastWatched, movieMap, tvMap, limit);
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('getRecentlyWatchedForUser:processWatchedDetails');
      console.log(`[PERF] Final processed watched details count: ${watchedDetails ? watchedDetails.length : 0}`);
      console.timeEnd('getRecentlyWatchedForUser:total');
    }
    
    return watchedDetails;
  } catch (error) {
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('getRecentlyWatchedForUser:total');
    }
    console.error(`Error in getRecentlyWatchedForUser: ${error.message}`);
    throw error;
  }
}


export async function getRecentlyAddedMedia({ page = 0, limit = 12, countOnly = false }) {
  try {
    const client = await clientPromise
    const db = client.db('Media')

    // Define projection fields for Movies
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
      // Add other necessary fields
    }

    // Define projection fields for TV Shows, including computation for latestMediaLastModified
    const tvShowProjectionFields = {
      _id: 1,
      title: 1,
      metadata: 1,
      posterURL: 1,
      posterBlurhash: 1,
      backdrop: 1,
      backdropBlurhash: 1,
      posterBlurhashSource: 1,
      backdropBlurhashSource: 1,
      // Add other necessary fields
      latestMediaLastModified: {
        $max: {
          $map: {
            input: "$seasons",
            as: "season",
            in: {
              $max: "$$season.episodes.mediaLastModified"
            }
          }
        }
      }
    }

    const pipeline = [
      {
        $project: movieProjectionFields,
      },
      {
        $unionWith: {
          coll: 'TV',
          pipeline: [
            {
              $project: tvShowProjectionFields,
            },
          ],
        },
      },
      {
        $addFields: {
          mediaLastModified: {
            $ifNull: ['$mediaLastModified', '$latestMediaLastModified'],
          },
          type: {
            $cond: [
              { $ifNull: ['$mediaLastModified', false] },
              'movie',
              'tv',
            ],
          },
        },
      },
      {
        $sort: { mediaLastModified: -1 },
      },
      {
        $skip: page * limit,
      },
      {
        $limit: limit,
      },
    ]

    const combinedMedia = await db.collection('Movies').aggregate(pipeline, {
      hint: 'mediaLastModified' // Use index for sorting by mediaLastModified
    }).toArray()

    // Separate movies and TV shows
    const movies = combinedMedia.filter((item) => item.type === 'movie')
    const tvShows = combinedMedia.filter((item) => item.type === 'tv')

    if (countOnly) {
      return Math.min(movies.length + tvShows.length, limit)
    }

    // Add URLs to media
    const [moviesWithUrl, tvShowsWithUrl] = await Promise.all([
      addCustomUrlToMedia(movies, 'movie'),
      addCustomUrlToMedia(tvShows, 'tv'),
    ])

    // Arrange media by latest modification
    const arrangedMedia = arrangeMediaByLatestModification(moviesWithUrl, tvShowsWithUrl)

    return arrangedMedia
  } catch (error) {
    console.error(`Error in getRecentlyAddedMedia: ${error.message}`)
    throw error
  }
}

export async function fetchRecentlyAdded({
  db,
  collectionName,
  limit = 12,
  skip = 0,
  countOnly = false,
}) {
  let sortField = {}
  let projectionFields = {}

  if (collectionName === 'Movies') {
    sortField = { mediaLastModified: -1 }
    projectionFields = movieProjectionFields
  } else if (collectionName === 'TV') {
    sortField = { 'seasons.episodes.mediaLastModified': -1 }
    projectionFields = tvShowProjectionFields
  }

  if (countOnly) {
    if (limit) {
      const count = await db.collection(collectionName).countDocuments()
      return Math.min(count, limit)
    }
    return await db.collection(collectionName).countDocuments()
  }
  return await db
    .collection(collectionName)
    .find({}, { projection: projectionFields })
    .sort(sortField)
    .skip(skip)
    .limit(limit)
    .hint(collectionName === 'Movies' ? 'release_date' : 'episode_last_modified')
    .toArray()
}
