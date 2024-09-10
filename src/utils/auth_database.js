'use server'

import clientPromise from '@src/lib/mongodb'
import { auth } from '../lib/auth'
import { ObjectId } from 'mongodb'
import { fetchMetadata } from './admin_utils'
import { movieProjectionFields, tvShowProjectionFields } from './auth_utils'

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
        const blurhashString = await fetchMetadata(item.backdropBlurhash)
        if (blurhashString.error) {
          return { error: blurhashString.error, status: blurhashString.status }
        }
        item.backdropBlurhash = blurhashString
      }
      if (item && item._id) {
        delete item._id
      }
    }

    return media // Return the array of media objects
  } catch (error) {
    return { error: 'Failed to fetch media', status: 500 }
  }
}

export async function fetchRecentlyAdded(db, collectionName, limit = 12, countOnly = false) {
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
    return await db.collection(collectionName).countDocuments()
  }

  return await db
    .collection(collectionName)
    .find({}, { projection: projectionFields })
    .sort(sortField)
    .limit(limit)
    .toArray()
}

export async function addCustomUrlToMedia(mediaArray, type) {
  return await Promise.all(
    mediaArray.map(async (media) => {
      let returnObj = {
        ...media,
        url: `/list/${type}/${encodeURIComponent(media.title)}`,
        description: media.metadata?.overview,
        type,
      }
      if (media.posterBlurhash) {
        returnObj.posterBlurhash = await fetchMetadata(
          media.posterBlurhash,
          'blurhash',
          type,
          media.title
        )
      }
      return returnObj
    })
  )
}
