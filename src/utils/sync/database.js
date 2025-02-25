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
    throw error
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
    .updateOne({ title }, updates, { upsert: true })

  if (result.matchedCount === 0) {
    console.warn(`No matching document found for ${mediaType}: "${title}".`)
  }

  await updateMediaUpdates(title, mediaType)
}

export async function updateLastSynced(client) {
  const result = await client
    .db('app_config')
    .collection('syncInfo')
    .updateOne({ _id: 'lastSyncTime' }, { $set: { timestamp: new Date() } }, { upsert: true })
  return result
}
