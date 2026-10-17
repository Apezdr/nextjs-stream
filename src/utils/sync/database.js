import { MediaType } from './utils'
import { updateMediaUpdates } from '@src/utils/admin_frontend_database'

/**
 * Updates an episode in the database.
 * @param {Object} client - Database client
 * @param {string} showTitle - Show title
 * @param {number} seasonNumber - Season number
 * @param {number} episodeNumber - Episode number
 * @param {Object} updates - Update operations
 * @returns {Promise<Object>} Update result
 */
export async function updateEpisodeInDatabase(
  client,
  showTitle,
  seasonNumber,
  episodeNumber,
  updates
) {
  const updateOperation = {}

  // Handle $set operations
  if (updates.set && Object.keys(updates.set).length > 0) {
    updateOperation.$set = {}
    for (const [key, value] of Object.entries(updates.set)) {
      // Special handling for metadata array updates
      if (key === 'metadata' && updates.seasonMetadataEpisodes) {
        // Update only the season's metadata.episodes array using arrayFilters
        updateOperation.$set['seasons.$[season].metadata.episodes'] = updates.seasonMetadataEpisodes
      } else {
        updateOperation.$set[`seasons.$[season].episodes.$[episode].${key}`] = value
      }
    }
  }

  // Handle $unset operations
  if (updates.unset && Array.isArray(updates.unset) && updates.unset.length > 0) {
    updateOperation.$unset = {}
    for (const key of updates.unset) {
      updateOperation.$unset[`seasons.$[season].episodes.$[episode].${key}`] = ''
    }
  }

  // If no operations are specified, exit early
  if (Object.keys(updateOperation).length === 0) {
    console.warn('No valid update operations provided.')
    return
  }

  console.log(`Updating show: ${showTitle}, Season: ${seasonNumber}, Episode: ${episodeNumber}`)
  if (Boolean(process.env.DEBUG) == true) {
    console.log('Update Operation:', JSON.stringify(updateOperation, null, 2))
  }
  
  try {
    const result = await client
      .db('Media')
      .collection('TV')
      .updateOne({ title: showTitle }, updateOperation, {
        arrayFilters: [
          { 'season.seasonNumber': seasonNumber },
          { 'episode.episodeNumber': episodeNumber },
        ],
      })

    console.log('Update Result:', result)

    if (result.matchedCount === 0) {
      console.warn(
        `No matching document found for show "${showTitle}" Season ${seasonNumber} Episode ${episodeNumber}.`
      )
    } else if (result.modifiedCount === 0) {
      console.warn(
        `No changes were made to show "${showTitle}" Season ${seasonNumber} Episode ${episodeNumber}.`
      )
    } else {
      console.log(
        `Successfully updated show "${showTitle}" Season ${seasonNumber} Episode ${episodeNumber}.`
      )
    }

    return result
  } catch (error) {
    console.error(
      `Error updating show "${showTitle}" Season ${seasonNumber} Episode ${episodeNumber}:`,
      error
    )
    // Return error object instead of throwing
    return {
      error: {
        message: error.message,
        stack: error.stack
      }
    }
  }
}

/**
 * Updates media in the database.
 * @param {Object} client - Database client
 * @param {string} mediaType - Media type (TV or MOVIE)
 * @param {string} title - Media title
 * @param {Object} updates - Update operations
 * @param {string} serverId - Server ID
 * @returns {Promise<void>}
 */
export async function updateMediaInDatabase(client, mediaType, title, updates, serverId) {
  const collectionName = mediaType === MediaType.TV ? 'TV' : 'Movies'

  try {
    // Validate that 'updates' contains valid MongoDB update operators
    const allowedOperators = [
      '$set',
      '$unset',
      '$inc',
      '$push',
      '$pull',
      '$addToSet',
      '$rename',
      '$currentDate',
    ]
    const updateKeys = Object.keys(updates)

    const hasValidOperator = updateKeys.some((key) => allowedOperators.includes(key))
    if (!hasValidOperator) {
      throw new Error(`Invalid update operators provided: ${updateKeys.join(', ')}`)
    }

    const result = await client
      .db('Media')
      .collection(collectionName)
      .updateOne({ title: title }, updates, { upsert: true })

    if (result.matchedCount === 0) {
      console.warn(`No matching document found for ${mediaType}: "${title}".`)
    }

    await updateMediaUpdates(title, mediaType)
    return result
  } catch (error) {
    console.error(`Error updating ${mediaType} "${title}":`, error)
    // Return error object instead of throwing
    return {
      error: {
        message: error.message,
        stack: error.stack
      }
    }
  }
}

/**
 * `app_config.syncInfo` document holding what the last COMPLETE pass applied:
 * each server's TV and movie payload ETags, the gate version and server set it
 * ran under, its syncRunId and how many documents carried that id. A sync tick
 * reads it to decide whether it can be skipped (sync/tickSkip.js). Its absence
 * means "no complete pass on record": the next tick fetches in full.
 */
const APPLIED_PAYLOADS_ID = 'appliedPayloads'

/**
 * @param {Object} client - MongoDB client
 * @returns {Promise<Object|null>} The stored record, or null when there is none
 */
export async function getAppliedPayloads(client) {
  return client.db('app_config').collection('syncInfo').findOne({ _id: APPLIED_PAYLOADS_ID })
}

/**
 * Record what a complete pass applied. Throws on failure: the caller decides.
 * @param {Object} client - MongoDB client
 * @param {Object} record - { servers, gateVersion, serversFingerprint, syncRunId, documentCounts }
 */
export async function setAppliedPayloads(client, record) {
  await client
    .db('app_config')
    .collection('syncInfo')
    .replaceOne(
      { _id: APPLIED_PAYLOADS_ID },
      { _id: APPLIED_PAYLOADS_ID, ...record, recordedAt: new Date() },
      { upsert: true }
    )
}

/**
 * Forget the last complete pass, so no tick is skipped until another pass
 * completes. Throws on failure: the caller decides.
 * @param {Object} client - MongoDB client
 */
export async function clearAppliedPayloads(client) {
  await client.db('app_config').collection('syncInfo').deleteOne({ _id: APPLIED_PAYLOADS_ID })
}

export async function updateLastSynced(client) {
  try {
    const result = await client
      .db('app_config')
      .collection('syncInfo')
      .updateOne({ _id: 'lastSyncTime' }, { $set: { timestamp: new Date() } }, { upsert: true })
    return result
  } catch (error) {
    console.error('Error updating last synced timestamp:', error)
    // Return error object instead of throwing
    return {
      error: {
        message: error.message,
        stack: error.stack
      }
    }
  }
}
