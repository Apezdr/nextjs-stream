import { ObjectId } from 'mongodb'
import isAuthenticated, { isAuthenticatedEither } from '../../../../../utils/routeAuth'
import clientPromise from '../../../../../lib/mongodb'
import { validateURL } from '@src/utils/auth_utils'
import { generateNormalizedVideoId } from '@src/utils/flatDatabaseUtils'

/**
 * Extracts and formats metadata for storage in PlaybackStatus
 * @param {Object} mediaMetadata - The media metadata object from the frontend
 * @returns {Object} Formatted metadata for database storage
 */
function extractPlaybackMetadata(mediaMetadata) {
  if (!mediaMetadata) {
    return {
      mediaType: null,
      mediaId: null,
      showId: null,
      seasonNumber: null,
      episodeNumber: null
    }
  }

  return {
    mediaType: mediaMetadata.mediaType || null,
    mediaId: mediaMetadata.mediaId || null,
    showId: mediaMetadata.showId || null,
    seasonNumber: mediaMetadata.seasonNumber || null,
    episodeNumber: mediaMetadata.episodeNumber || null
  }
}

export const POST = async (req) => {
  const authResult = await isAuthenticatedEither(req)
  if (authResult instanceof Response) {
    return authResult // Stop execution and return the unauthorized response
  }

  try {
    const body = await req.json()
    const { videoId, playbackTime, mediaMetadata } = body

    // Extract and format metadata for storage
    const playbackMetadata = extractPlaybackMetadata(mediaMetadata)

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
      
      // Check if we need to update metadata (if any metadata fields are missing or different)
      const needsMetadataUpdate = !existingVideo.mediaType ||
                                  !existingVideo.mediaId ||
                                  (playbackMetadata.mediaType && existingVideo.mediaType !== playbackMetadata.mediaType) ||
                                  (playbackMetadata.showId && existingVideo.showId !== playbackMetadata.showId?.toString());
      
      // Build metadata update object conditionally
      let metadataUpdate = {}
      if (needsMetadataUpdate && playbackMetadata.mediaType) {
        metadataUpdate['videosWatched.$.mediaType'] = playbackMetadata.mediaType
        if (playbackMetadata.mediaId) {
          metadataUpdate['videosWatched.$.mediaId'] = playbackMetadata.mediaId
        }
        
        // Only add TV-specific fields for TV content
        if (playbackMetadata.mediaType === 'tv') {
          if (playbackMetadata.showId) {
            metadataUpdate['videosWatched.$.showId'] = playbackMetadata.showId
          }
          if (playbackMetadata.seasonNumber) {
            metadataUpdate['videosWatched.$.seasonNumber'] = playbackMetadata.seasonNumber
          }
          if (playbackMetadata.episodeNumber) {
            metadataUpdate['videosWatched.$.episodeNumber'] = playbackMetadata.episodeNumber
          }
        }
      }
      
      // Update playback time for existing videoId (and validation/normalized ID/metadata info if needed)
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
            } : {}),
            ...metadataUpdate
          },
        }
      )
    } else {
      // For new videos, validate the URL before adding
      const isValid = await validateURL(videoId)
      
      // Generate a normalized video ID for consistent lookup
      const normalizedVideoId = generateNormalizedVideoId(videoId);
      console.log(`Generated normalized ID for new video: ${normalizedVideoId} (original: ${videoId})`);
      
      // Build the video entry object with conditional metadata fields
      const videoEntry = {
        videoId,
        normalizedVideoId,
        playbackTime,
        lastUpdated: new Date(),
        isValid,
        lastScanned: new Date().toISOString()
      }

      // Add metadata fields only if they exist and are relevant
      if (playbackMetadata.mediaType) {
        videoEntry.mediaType = playbackMetadata.mediaType
      }
      if (playbackMetadata.mediaId) {
        videoEntry.mediaId = playbackMetadata.mediaId
      }
      
      // Only add TV-specific fields for TV content
      if (playbackMetadata.mediaType === 'tv') {
        if (playbackMetadata.showId) {
          videoEntry.showId = playbackMetadata.showId
        }
        if (playbackMetadata.seasonNumber) {
          videoEntry.seasonNumber = playbackMetadata.seasonNumber
        }
        if (playbackMetadata.episodeNumber) {
          videoEntry.episodeNumber = playbackMetadata.episodeNumber
        }
      }

      // Add new videoId with playback time, validation result, normalized ID, and relevant metadata
      await playbackStatusCollection.updateOne(
        { userId: userIdObj },
        {
          $push: {
            videosWatched: videoEntry
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
