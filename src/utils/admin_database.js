import getMetadata from '@components/movieMetadata'
import clientPromise from '../lib/mongodb'
import { ObjectId } from 'mongodb'
import { extractTVShowDetails } from './admin_frontend_database'
import { fileServerURL } from './config'

export async function getAllMedia() {
  const client = await clientPromise
  const movies = await client.db('Media').collection('Movies').find({}).toArray()
  const tv = await client.db('Media').collection('TV').find({}).toArray()
  return {
    movies,
    tv,
  }
}

export async function updateMetadata({ type, media_title, tvSeriesData = null }) {
  const client = await clientPromise
  const collection = type === 'movie' ? 'Movies' : 'TV'

  if (type === 'tv' && tvSeriesData) {
    // Handling metadata updates for a TV series with its seasons
    for (let i = 0; i < tvSeriesData.seasons.length; i++) {
      if (!tvSeriesData.seasons[i].metadata) {
        const seasonMetadata = await getMetadata({
          title: media_title,
          season: tvSeriesData.seasons[i].seasonNumber,
          type: type,
        })
        tvSeriesData.seasons[i].metadata = seasonMetadata

        // Update the season metadata in the database
        await client
          .db('Media')
          .collection(collection)
          .updateOne(
            {
              _id: new ObjectId(tvSeriesData._id),
              'seasons.seasonNumber': tvSeriesData.seasons[i].seasonNumber,
            },
            { $set: { 'seasons.$.metadata': seasonMetadata } }
          )
      }
    }
  }
  // Fetch metadata for a movie or the entire TV show
  const metadata = await getMetadata({
    title: media_title,
    type: type,
  })

  if (metadata) {
    // Update the record in MongoDB
    await client
      .db('Media')
      .collection(collection)
      .updateOne({ title: media_title }, { $set: { metadata: metadata } })
  }
}

export async function getAllUsers() {
  const client = await clientPromise
  const users = await client.db('Users').collection('AuthenticatedUsers').find({}).toArray()
  return users
}

export async function getLastSynced() {
  const client = await clientPromise
  const lastSyncTime = await client
    .db('app_config')
    .collection('syncInfo')
    .findOne({ _id: 'lastSyncTime' })
  return lastSyncTime.timestamp || null
}

export async function getRecentlyWatched() {
  try {
    const client = await clientPromise
    const users = await client.db('Users').collection('AuthenticatedUsers').find({}).toArray()

    const lastWatchedPromises = users.map(async (user) => {
      try {
        const lastWatched = await client
          .db('Media')
          .collection('PlaybackStatus')
          .aggregate([
            { $match: { userId: user._id } },
            { $unwind: '$videosWatched' },
            { $sort: { 'videosWatched.lastUpdated': -1 } },
            { $limit: 4 },
            { $group: { _id: '$_id', videosWatched: { $push: '$videosWatched' } } },
          ])
          .toArray()

        if (lastWatched.length === 0 || !lastWatched[0].videosWatched) {
          return null
        }

        let mostRecentWatch = null
        const watchedDetails = await Promise.all(
          lastWatched[0].videosWatched.map(async (video) => {
            // Update mostRecentWatch with the latest timestamp
            if (!mostRecentWatch || video.lastUpdated > mostRecentWatch) {
              mostRecentWatch = video.lastUpdated
            }
            try {
              if (
                video.videoId.startsWith(fileServerURL + `/movies`) ||
                video.videoId.startsWith(fileServerURL + `/limited`)
              ) {
                const movie = await client
                  .db('Media')
                  .collection('Movies')
                  .findOne({ videoURL: video.videoId })
                return movie
                  ? {
                      ...movie,
                      type: 'movie',
                      playbackTime: video.playbackTime,
                      lastUpdated: video.lastUpdated,
                    }
                  : null
              } else if (video.videoId.startsWith(fileServerURL + `/tv`)) {
                const tvDetails = await extractTVShowDetails(client, video.videoId)
                return tvDetails
                  ? {
                      ...tvDetails,
                      type: 'tv',
                      playbackTime: video.playbackTime,
                      lastUpdated: video.lastUpdated,
                    }
                  : null
              }
            } catch (innerError) {
              console.error(`Error processing video details: ${innerError.message}`)
              return null
            }
          })
        )

        return {
          user: {
            name: user.name,
            image: user.image,
          },
          videos: watchedDetails.filter((detail) => detail !== null),
          mostRecentWatch: mostRecentWatch,
        }
      } catch (userError) {
        console.error(`Error processing user ${user.name}: ${userError.message}`)
        return null
      }
    })

    const lastWatched = await Promise.all(lastWatchedPromises)
    return lastWatched
      .filter((entry) => entry)
      .sort((a, b) => b.mostRecentWatch - a.mostRecentWatch)
  } catch (error) {
    console.error(`Error in getRecentlyWatched: ${error.message}`)
    throw error
  }
}
