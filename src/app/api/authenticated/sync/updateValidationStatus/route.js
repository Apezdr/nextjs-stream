import { ObjectId } from 'mongodb'
import isAuthenticated from '../../../../../utils/routeAuth'
import clientPromise from '../../../../../lib/mongodb'

/**
 * @param {*} req
 * Handles POST requests to update the validation status of a video in the user's watch history.
 * Expects a JSON body with `videoId` and `isValid` fields.
 * @returns {Response} - Returns a JSON response indicating success or failure.
 * If the user is not authenticated, returns a 401 Unauthorized response.
 */
export const POST = async (req) => {
  const authResult = await isAuthenticated(req)
  if (authResult instanceof Response) {
    return authResult // Stop execution and return the unauthorized response
  }

  try {
    const body = await req.json()
    const { videoId, isValid } = body

    // Convert userId string to ObjectId
    const userIdObj = new ObjectId(authResult.id)

    const client = await clientPromise
    const db = client.db('Media')
    const playbackStatusCollection = db.collection('PlaybackStatus')

    // Update the isValid flag for the specific video in user's watch history
    const result = await playbackStatusCollection.updateOne(
      { 
        userId: userIdObj, 
        'videosWatched.videoId': videoId 
      },
      {
        $set: {
          'videosWatched.$.isValid': isValid,
          'videosWatched.$.lastScanned': new Date().toISOString()
        }
      }
    )

    // Also try with normalizedVideoId if the direct videoId update didn't work
    if (result.modifiedCount === 0) {
      await playbackStatusCollection.updateOne(
        { 
          userId: userIdObj, 
          'videosWatched.normalizedVideoId': videoId 
        },
        {
          $set: {
            'videosWatched.$.isValid': isValid,
            'videosWatched.$.lastScanned': new Date().toISOString()
          }
        }
      )
    }

    console.log(`Updated validation status for video ${videoId}: isValid = ${isValid}`)

    return new Response(JSON.stringify({ 
      message: 'Validation status updated',
      videoId,
      isValid 
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Validation status update error:', error)
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
