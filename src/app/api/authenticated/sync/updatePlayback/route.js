import { ObjectId } from 'mongodb'
import isAuthenticated from '../../../../../utils/routeAuth'
import clientPromise from '../../../../../lib/mongodb'

export const POST = async (req) => {
  const authResult = await isAuthenticated(req)
  if (authResult instanceof Response) {
    return authResult // Stop execution and return the unauthorized response
  }

  try {
    const body = await req.json()
    const { videoId, playbackTime } = body

    // Convert userId string to ObjectId
    const userIdObj = new ObjectId(authResult.id)

    const client = await clientPromise
    const db = client.db('Media')
    const playbackStatusCollection = db.collection('PlaybackStatus')

    // Check if the videoId already exists for the user
    const userPlaybackStatus = await playbackStatusCollection.findOne({
      userId: userIdObj,
      'videosWatched.videoId': videoId,
    })

    if (userPlaybackStatus) {
      // Update playback time for existing videoId
      await playbackStatusCollection.updateOne(
        { userId: userIdObj, 'videosWatched.videoId': videoId },
        {
          $set: {
            'videosWatched.$.playbackTime': playbackTime,
            'videosWatched.$.lastUpdated': new Date(),
          },
        }
      )
    } else {
      // Add new videoId with playback time
      await playbackStatusCollection.updateOne(
        { userId: userIdObj },
        { $push: { videosWatched: { videoId, playbackTime, lastUpdated: new Date() } } },
        { upsert: true }
      )
    }

    return new Response(JSON.stringify({ message: 'Playback status updated' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Playback update error:', error)
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
