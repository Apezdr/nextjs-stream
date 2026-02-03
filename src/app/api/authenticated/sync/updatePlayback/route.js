import { ObjectId } from 'mongodb'
import isAuthenticated, { isAuthenticatedEither } from '../../../../../utils/routeAuth'
import clientPromise from '../../../../../lib/mongodb'
import { validateURL } from '@src/utils/auth_utils'
import { generateNormalizedVideoId } from '@src/utils/flatDatabaseUtils'
import { createPlaybackDeviceInfo, updatePlaybackDeviceInfo } from '@src/utils/deviceDetection'

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
    
    // Capture device information from User-Agent
    const userAgent = req.headers.get('user-agent')
    const deviceInfo = createPlaybackDeviceInfo(userAgent)

    // Convert userId string to ObjectId
    const userIdObj = new ObjectId(authResult.id)
    
    // Generate normalized video ID for consistent lookup (PRIMARY KEY)
    const normalizedVideoId = generateNormalizedVideoId(videoId)
    console.log(`Using normalized ID as primary key: ${normalizedVideoId} (original: ${videoId})`)

    const client = await clientPromise
    const db = client.db('Media')
    const playbackStatusCollection = db.collection('PlaybackStatus')

    // ATOMIC OPERATION: Use normalizedVideoId as primary lookup key to prevent race conditions
    // First, try to find and update existing entry using normalizedVideoId
    const existingByNormalizedId = await playbackStatusCollection.findOneAndUpdate(
      {
        userId: userIdObj,
        'videosWatched.normalizedVideoId': normalizedVideoId,
      },
      {
        $set: {
          'videosWatched.$.playbackTime': playbackTime,
          'videosWatched.$.lastUpdated': new Date(),
          'videosWatched.$.videoId': videoId, // Update videoId in case URL changed
        }
      },
      {
        returnDocument: 'after'
      }
    )

    if (existingByNormalizedId && existingByNormalizedId.value) {
      // Found existing entry by normalizedVideoId - update additional fields if needed
      const existingVideo = existingByNormalizedId.value.videosWatched.find(
        v => v.normalizedVideoId === normalizedVideoId
      );
      
      // Prepare additional updates
      let additionalUpdates = {}
      let needsAdditionalUpdate = false
      
      // Check if we need to validate this video (if it hasn't been validated in the last 24 hours)
      const needsValidation = !existingVideo.isValid || !existingVideo.lastScanned || 
                             new Date(existingVideo.lastScanned) < new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      if (needsValidation) {
        console.log(`Validating existing video that hasn't been checked in 24+ hours: ${videoId}`);
        const isValid = await validateURL(videoId);
        additionalUpdates['videosWatched.$.isValid'] = isValid;
        additionalUpdates['videosWatched.$.lastScanned'] = new Date().toISOString();
        needsAdditionalUpdate = true;
      }
      
      // Check if we need to update metadata
      const needsMetadataUpdate = !existingVideo.mediaType ||
                                  !existingVideo.mediaId ||
                                  (playbackMetadata.mediaType && existingVideo.mediaType !== playbackMetadata.mediaType) ||
                                  (playbackMetadata.showId && existingVideo.showId !== playbackMetadata.showId?.toString());
      
      if (needsMetadataUpdate && playbackMetadata.mediaType) {
        additionalUpdates['videosWatched.$.mediaType'] = playbackMetadata.mediaType;
        if (playbackMetadata.mediaId) {
          additionalUpdates['videosWatched.$.mediaId'] = playbackMetadata.mediaId;
        }
        
        // Only add TV-specific fields for TV content
        if (playbackMetadata.mediaType === 'tv') {
          if (playbackMetadata.showId) {
            additionalUpdates['videosWatched.$.showId'] = playbackMetadata.showId;
          }
          if (playbackMetadata.seasonNumber) {
            additionalUpdates['videosWatched.$.seasonNumber'] = playbackMetadata.seasonNumber;
          }
          if (playbackMetadata.episodeNumber) {
            additionalUpdates['videosWatched.$.episodeNumber'] = playbackMetadata.episodeNumber;
          }
        }
        needsAdditionalUpdate = true;
      }
      
      // Update device information (always merge device info)
      const updatedDeviceInfo = updatePlaybackDeviceInfo(existingVideo.deviceInfo, userAgent);
      additionalUpdates['videosWatched.$.deviceInfo'] = updatedDeviceInfo;
      needsAdditionalUpdate = true;
      
      // Apply additional updates if needed
      if (needsAdditionalUpdate) {
        await playbackStatusCollection.updateOne(
          {
            userId: userIdObj,
            'videosWatched.normalizedVideoId': normalizedVideoId,
          },
          {
            $set: additionalUpdates
          }
        );
      }
      
      console.log(`Updated existing entry using normalizedVideoId: ${normalizedVideoId}`);
    } else {
      // No existing entry found by normalizedVideoId - check for legacy entries by videoId
      const existingByVideoId = await playbackStatusCollection.findOne({
        userId: userIdObj,
        'videosWatched.videoId': videoId,
      });

      if (existingByVideoId) {
        // Found legacy entry by videoId - update it and add normalizedVideoId
        console.log(`Migrating legacy entry from videoId to normalizedVideoId: ${videoId} -> ${normalizedVideoId}`);
        
        const legacyVideo = existingByVideoId.videosWatched.find(v => v.videoId === videoId);
        
        // Check validation needs
        let isValid = legacyVideo.isValid;
        let lastScanned = legacyVideo.lastScanned;
        const needsValidation = !isValid || !lastScanned || 
                               new Date(lastScanned) < new Date(Date.now() - 24 * 60 * 60 * 1000);
        
        if (needsValidation) {
          isValid = await validateURL(videoId);
          lastScanned = new Date().toISOString();
        }
        
        // Update device information
        const updatedDeviceInfo = updatePlaybackDeviceInfo(legacyVideo.deviceInfo, userAgent);
        
        // Build metadata update object
        let metadataUpdate = {}
        if (playbackMetadata.mediaType) {
          metadataUpdate['videosWatched.$.mediaType'] = playbackMetadata.mediaType;
          if (playbackMetadata.mediaId) {
            metadataUpdate['videosWatched.$.mediaId'] = playbackMetadata.mediaId;
          }
          
          // Only add TV-specific fields for TV content
          if (playbackMetadata.mediaType === 'tv') {
            if (playbackMetadata.showId) {
              metadataUpdate['videosWatched.$.showId'] = playbackMetadata.showId;
            }
            if (playbackMetadata.seasonNumber) {
              metadataUpdate['videosWatched.$.seasonNumber'] = playbackMetadata.seasonNumber;
            }
            if (playbackMetadata.episodeNumber) {
              metadataUpdate['videosWatched.$.episodeNumber'] = playbackMetadata.episodeNumber;
            }
          }
        }
        
        // Update the legacy entry with normalizedVideoId and other improvements
        await playbackStatusCollection.updateOne(
          { userId: userIdObj, 'videosWatched.videoId': videoId },
          {
            $set: {
              'videosWatched.$.playbackTime': playbackTime,
              'videosWatched.$.lastUpdated': new Date(),
              'videosWatched.$.normalizedVideoId': normalizedVideoId, // ADD NORMALIZED ID
              'videosWatched.$.deviceInfo': updatedDeviceInfo,
              ...(needsValidation ? {
                'videosWatched.$.isValid': isValid,
                'videosWatched.$.lastScanned': lastScanned
              } : {}),
              ...metadataUpdate
            },
          }
        );
      } else {
        // Completely new entry - validate and create
        const isValid = await validateURL(videoId);
        
        // Build the video entry object with conditional metadata fields
        const videoEntry = {
          videoId,
          normalizedVideoId,
          playbackTime,
          lastUpdated: new Date(),
          isValid,
          lastScanned: new Date().toISOString(),
          deviceInfo: deviceInfo
        };

        // Add metadata fields only if they exist and are relevant
        if (playbackMetadata.mediaType) {
          videoEntry.mediaType = playbackMetadata.mediaType;
        }
        if (playbackMetadata.mediaId) {
          videoEntry.mediaId = playbackMetadata.mediaId;
        }
        
        // Only add TV-specific fields for TV content
        if (playbackMetadata.mediaType === 'tv') {
          if (playbackMetadata.showId) {
            videoEntry.showId = playbackMetadata.showId;
          }
          if (playbackMetadata.seasonNumber) {
            videoEntry.seasonNumber = playbackMetadata.seasonNumber;
          }
          if (playbackMetadata.episodeNumber) {
            videoEntry.episodeNumber = playbackMetadata.episodeNumber;
          }
        }

        // Use ATOMIC upsert to prevent race conditions
        await playbackStatusCollection.updateOne(
          { userId: userIdObj },
          {
            $push: {
              videosWatched: videoEntry
            }
          },
          { upsert: true }
        );
        
        console.log(`Added new video with normalized ID: ${normalizedVideoId} (validation: ${isValid ? 'valid' : 'invalid'})`);
      }
    }

    return new Response(JSON.stringify({ message: 'Playbook status updated successfully' }), {
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
