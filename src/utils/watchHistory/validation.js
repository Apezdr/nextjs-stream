/**
 * Watch History Validation
 * 
 * Validates playback entries against current database state
 * Ensures URLs are still valid and media exists
 */

import clientPromise from '@src/lib/mongodb'
import { ObjectId } from 'mongodb'
import { generateNormalizedVideoId } from '@src/utils/flatDatabaseUtils'
import { validateURL } from '@src/utils/auth_utils'
import { createLogger } from '@src/lib/logger'

const log = createLogger('WatchHistory.Validation')

/**
 * Validate all playback entries against current state of FlatMovies and FlatEpisodes
 * Called after sync operations complete to mark invalid entries
 * 
 * @returns {Promise<Object>} Validation results with counts
 */
export async function validateAllPlaybackEntries() {
  try {
    const client = await clientPromise
    const db = client.db('Media')

    log.info('Starting bulk playback validation against database...')

    const watchHistoryCollection = db.collection('WatchHistory')
    const flatMoviesCollection = db.collection('FlatMovies')
    const flatEpisodesCollection = db.collection('FlatEpisodes')

    // Build lookup sets of valid normalized video IDs
    const [movies, episodes] = await Promise.all([
      flatMoviesCollection.find({}, { projection: { normalizedVideoId: 1 } }).toArray(),
      flatEpisodesCollection.find({}, { projection: { normalizedVideoId: 1 } }).toArray()
    ])

    const validVideoIds = new Set([
      ...movies.map(m => m.normalizedVideoId),
      ...episodes.map(e => e.normalizedVideoId)
    ])

    log.debug({ validVideos: validVideoIds.size }, 'Built valid video ID lookup set')

    // Get all playback entries
    const playbackEntries = await watchHistoryCollection.find({}).toArray()

    let validCount = 0
    let invalidCount = 0
    let errorCount = 0

    // Process each entry
    for (const entry of playbackEntries) {
      try {
        const isValid = validVideoIds.has(entry.normalizedVideoId)

        if (isValid !== entry.isValid) {
          await watchHistoryCollection.updateOne(
            { _id: entry._id },
            {
              $set: {
                isValid,
                lastScanned: new Date().toISOString()
              }
            }
          )
        }

        if (isValid) {
          validCount++
        } else {
          invalidCount++
        }
      } catch (error) {
        log.error({ error, entryId: entry._id }, 'Error validating entry')
        errorCount++
      }
    }

    const result = { validCount, invalidCount, errorCount, totalProcessed: playbackEntries.length }

    log.info(result, 'Playback validation complete')

    return result
  } catch (error) {
    log.error({ error }, 'Failed to validate playback entries')
    throw error
  }
}

/**
 * Validate a specific user's playback entries
 * 
 * @param {string|ObjectId} userId - User ID
 * @returns {Promise<Object>} Validation results for this user
 */
export async function validateUserPlaybackEntries(userId) {
  try {
    const client = await clientPromise
    const db = client.db('Media')
    const userIdObj = typeof userId === 'string' ? new ObjectId(userId) : userId

    log.debug({ userId: userIdObj.toString() }, 'Validating playback entries for user')

    const watchHistoryCollection = db.collection('WatchHistory')
    const flatMoviesCollection = db.collection('FlatMovies')
    const flatEpisodesCollection = db.collection('FlatEpisodes')

    // Build lookup sets
    const [movies, episodes] = await Promise.all([
      flatMoviesCollection.find({}, { projection: { normalizedVideoId: 1 } }).toArray(),
      flatEpisodesCollection.find({}, { projection: { normalizedVideoId: 1 } }).toArray()
    ])

    const validVideoIds = new Set([
      ...movies.map(m => m.normalizedVideoId),
      ...episodes.map(e => e.normalizedVideoId)
    ])

    // Get user's entries
    const userEntries = await watchHistoryCollection.find({ userId: userIdObj }).toArray()

    let validCount = 0
    let invalidCount = 0
    let alreadyValid = 0

    // Process each entry
    for (const entry of userEntries) {
      const isValid = validVideoIds.has(entry.normalizedVideoId)

      if (isValid === entry.isValid) {
        // Already correct
        if (isValid) {
          alreadyValid++
        }
        continue
      }

      // Update validation status
      await watchHistoryCollection.updateOne(
        { _id: entry._id },
        {
          $set: {
            isValid,
            lastScanned: new Date().toISOString()
          }
        }
      )

      if (isValid) {
        validCount++
      } else {
        invalidCount++
      }
    }

    const result = {
      userId: userIdObj.toString(),
      validCount,
      invalidCount,
      alreadyValid,
      totalProcessed: userEntries.length
    }

    log.debug(result, 'User playback validation complete')

    return result
  } catch (error) {
    log.error({ error, userId }, 'Failed to validate user playback entries')
    throw error
  }
}

/**
 * Validate and update a single playback entry's video availability
 * Can be called during playback tracking to validate URL is still accessible
 * 
 * @param {string|ObjectId} userId - User ID
 * @param {string} videoId - Video URL to validate
 * @param {string} normalizedVideoId - Normalized video ID
 * @returns {Promise<boolean>} True if video is still valid
 */
export async function validateAndUpdatePlaybackUrl(userId, videoId, normalizedVideoId) {
  try {
    const userIdObj = typeof userId === 'string' ? new ObjectId(userId) : userId

    // Check if video exists in database
    const client = await clientPromise
    const db = client.db('Media')

    // Check FlatMovies and FlatEpisodes
    const [movie, episode] = await Promise.all([
      db.collection('FlatMovies').findOne({ normalizedVideoId }),
      db.collection('FlatEpisodes').findOne({ normalizedVideoId })
    ])

    const isValid = !!(movie || episode)

    // Also validate URL is still accessible
    let urlValid = isValid
    if (!isValid) {
      try {
        urlValid = await validateURL(videoId)
      } catch (error) {
        log.warn({ error, videoId }, 'URL validation check failed')
        urlValid = false
      }
    }

    const finalValid = isValid || urlValid

    // Update watch history entry
    await db.collection('WatchHistory').updateOne(
      { userId: userIdObj, normalizedVideoId },
      {
        $set: {
          isValid: finalValid,
          lastScanned: new Date().toISOString()
        }
      }
    )

    log.debug({ userId: userIdObj.toString(), normalizedVideoId, isValid: finalValid }, 'Validated playback URL')

    return finalValid
  } catch (error) {
    log.error({ error, userId, videoId }, 'Failed to validate playback URL')
    return false
  }
}

/**
 * Check if a playback entry needs re-validation
 * Returns true if entry hasn't been validated in specified hours
 * 
 * @param {Object} entry - Watch history entry
 * @param {number} hoursThreshold - Hours before re-validation needed (default: 24)
 * @returns {boolean} True if entry needs validation
 */
export function needsValidation(entry, hoursThreshold = 24) {
  if (!entry.lastScanned) {
    return true
  }

  const lastScanned = new Date(entry.lastScanned)
  const hoursAgo = (Date.now() - lastScanned.getTime()) / (1000 * 60 * 60)

  return hoursAgo >= hoursThreshold
}

/**
 * Mark entries as needing re-validation
 * Called when database is synced/updated
 * 
 * @param {string|ObjectId|null} userId - User ID, or null to invalidate all
 * @returns {Promise<Object>} Update result
 */
export async function markPlaybackAsNeedingValidation(userId = null) {
  try {
    const client = await clientPromise
    const db = client.db('Media')
    const collection = db.collection('WatchHistory')

    const filter = userId ? { userId: typeof userId === 'string' ? new ObjectId(userId) : userId } : {}

    const result = await collection.updateMany(filter, {
      $unset: { lastScanned: '' }
    })

    log.info({ ...filter, modifiedCount: result.modifiedCount }, 'Marked playback as needing validation')

    return result
  } catch (error) {
    log.error({ error, userId }, 'Failed to mark playback as needing validation')
    throw error
  }
}
