import { ObjectId } from 'mongodb'
import isAuthenticated from '../../../../../utils/routeAuth'
import clientPromise from '../../../../../lib/mongodb'
import { validateURL } from '@src/utils/auth_utils'
import { generateNormalizedVideoId } from '@src/utils/flatDatabaseUtils'

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
      // Get the existing video entry
      const existingVideo = userPlaybackStatus.videosWatched.find(v => v.videoId === videoId);
      
      // Check if we need to validate this video (if it hasn't been validated in the last 24 hours)
      let isValid = existingVideo.isValid;
      let lastScanned = existingVideo.lastScanned;
      const needsValidation = !isValid || !lastScanned || 
                             new Date(lastScanned) < new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      if (needsValidation) {
        console.log(`Validating existing video that hasn't been checked in 24+ hours: ${videoId}`);
        isValid = await validateURL(videoId);
        lastScanned = new Date().toISOString();
      }
      
      // Check if we need to add or update the normalized video ID
      const needsNormalizedId = !existingVideo.normalizedVideoId;
      let normalizedVideoId = existingVideo.normalizedVideoId;
      
      if (needsNormalizedId) {
        normalizedVideoId = generateNormalizedVideoId(videoId);
        console.log(`Generated normalized ID for existing video: ${normalizedVideoId} (original: ${videoId})`);
      }
      
      // Update playback time for existing videoId (and validation/normalized ID info if needed)
      await playbackStatusCollection.updateOne(
        { userId: userIdObj, 'videosWatched.videoId': videoId },
        {
          $set: {
            'videosWatched.$.playbackTime': playbackTime,
            'videosWatched.$.lastUpdated': new Date(),
            ...(needsValidation ? {
              'videosWatched.$.isValid': isValid,
              'videosWatched.$.lastScanned': lastScanned
            } : {}),
            ...(needsNormalizedId ? {
              'videosWatched.$.normalizedVideoId': normalizedVideoId
            } : {})
          },
        }
      )
    } else {
      // For new videos, validate the URL before adding
      const isValid = await validateURL(videoId)
      
      // Generate a normalized video ID for consistent lookup
      const normalizedVideoId = generateNormalizedVideoId(videoId);
      console.log(`Generated normalized ID for new video: ${normalizedVideoId} (original: ${videoId})`);
      
      // Add new videoId with playback time, validation result, and normalized ID
      await playbackStatusCollection.updateOne(
        { userId: userIdObj },
        { 
          $push: { 
            videosWatched: { 
              videoId, 
              normalizedVideoId,
              playbackTime, 
              lastUpdated: new Date(),
              isValid,
              lastScanned: new Date().toISOString()
            } 
          } 
        },
        { upsert: true }
      )
      
      console.log(`Added new video to PlaybackStatus with validation result: ${isValid ? 'valid' : 'invalid'}`)
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
