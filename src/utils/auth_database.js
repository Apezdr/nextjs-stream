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
      if (item && item.backdropBlurhash) {
        const blurhashString = await fetchMetadataMultiServer(item.backdropBlurhashSource, item.backdropBlurhash, "blurhash")
        if (blurhashString.error) {
          return { error: blurhashString.error, status: blurhashString.status }
        }
        item.backdropBlurhash = blurhashString
      }
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
    if (item && item.backdropBlurhash) {
      const blurhashString = await fetchMetadataMultiServer(item.backdropBlurhashSource, item.backdropBlurhash, "blurhash")
      if (blurhashString.error) {
        return { error: blurhashString.error, status: blurhashString.status }
      }
      item.backdropBlurhash = blurhashString
    }
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
        returnObj.posterBlurhash = await fetchMetadataMultiServer(
          media.posterBlurhashSource,
          media.posterBlurhash,
          'blurhash',
          type,
          media.title
        )
      }
      if (media.backdropBlurhash) {
        returnObj.backdropBlurhash = await fetchMetadataMultiServer(
          media.backdropBlurhashSource,
          media.backdropBlurhash,
          'blurhash',
          type,
          media.title
        )
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
    .hint({ _id: 1 })
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
      if (record.posterBlurhash) {
        record.posterBlurhash = await fetchMetadataMultiServer(
          record.posterBlurhashSource,
          record.posterBlurhash,
          'blurhash',
          type,
          record.title
        )
      }
      if (record.backdropBlurhash) {
        record.backdropBlurhash = await fetchMetadataMultiServer(
          record.backdropBlurhashSource,
          record.backdropBlurhash,
          'blurhash',
          type,
          record.title
        )
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
    const client = await clientPromise;
    const user = await client
      .db('Users')
      .collection('AuthenticatedUsers')
      .findOne({ _id: new ObjectId(userId) });

    if (!user) {
      throw new Error(`User with ID ${userId} not found`);
    }

    const validPage = Math.max(page, 0); // Ensure page is at least 0

    if (countOnly) {
      // Fetch count of media that exists in the database
      const countAggregation = [
        { $match: { userId: user._id } },
        { $unwind: '$videosWatched' },
        {
          $lookup: {
            from: 'Movies',
            localField: 'videosWatched.videoId',
            foreignField: 'videoURL',
            as: 'movies',
          },
        },
        {
          $lookup: {
            from: 'TV',
            localField: 'videosWatched.videoId',
            foreignField: 'seasons.episodes.videoURL',
            as: 'tvShows',
          },
        },
        {
          $match: {
            $or: [
              { 'movies.0': { $exists: true } },
              { 'tvShows.0': { $exists: true } },
            ],
          },
        },
        { $count: 'total' },
      ];
      const countResult = await client
        .db('Media')
        .collection('PlaybackStatus')
        .aggregate(countAggregation)
        .toArray();
      return countResult.length > 0 ? countResult[0].total : 0;
    }

    // For non-count requests, filter out media not in the database before pagination
    const dataAggregation = [
      { $match: { userId: user._id } },
      { $unwind: '$videosWatched' },
      {
        $lookup: {
          from: 'Movies',
          localField: 'videosWatched.videoId',
          foreignField: 'videoURL',
          as: 'movie',
        },
      },
      {
        $lookup: {
          from: 'TV',
          localField: 'videosWatched.videoId',
          foreignField: 'seasons.episodes.videoURL',
          as: 'tvShow',
        },
      },
      {
        $match: {
          $or: [
            { 'movie.0': { $exists: true } },
            { 'tvShow.0': { $exists: true } },
          ],
        },
      },
      { $sort: { 'videosWatched.lastUpdated': -1 } }, // Sort after filtering
      { $skip: validPage * limit },
      { $limit: limit },
      {
        $group: {
          _id: '$userId',
          videosWatched: { $push: '$videosWatched' },
        },
      },
    ];

    const lastWatched = await client
      .db('Media')
      .collection('PlaybackStatus')
      .aggregate(dataAggregation, { hint: 'userId_1' })
      .toArray();

    if (lastWatched.length === 0 || !lastWatched[0].videosWatched) {
      return null;
    }

    const videoIds = lastWatched[0].videosWatched.map((video) => video.videoId);
    const uniqueVideoIds = [...new Set(videoIds)];

    // Bulk fetch movies and TV shows
    const [movies, tvShows] = await Promise.all([
      client
        .db('Media')
        .collection('Movies')
        .find({ videoURL: { $in: uniqueVideoIds } })
        .toArray(),
      client
        .db('Media')
        .collection('TV')
        .find({ 'seasons.episodes.videoURL': { $in: uniqueVideoIds } })
        .toArray(),
    ]);

    // Populate the movie and TV maps to match videoURLs to their respective records
    const movieMap = new Map(movies.map((movie) => [movie.videoURL, movie]));
    const tvMap = new Map();

    tvShows.forEach((tvShow) => {
      tvShow.seasons.forEach((season) => {
        season.episodes.forEach((episode) => {
          if (uniqueVideoIds.includes(episode.videoURL)) {
            tvMap.set(episode.videoURL, { ...tvShow, episode });
          }
        });
      });
    });

    const watchedDetails = await processWatchedDetails(lastWatched, movieMap, tvMap, limit);

    return watchedDetails;
  } catch (error) {
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

    const combinedMedia = await db.collection('Movies').aggregate(pipeline).toArray()

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
    .toArray()
}
