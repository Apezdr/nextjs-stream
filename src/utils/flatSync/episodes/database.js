/**
 * TV episode database operations for flat structure
 */

import { ObjectId } from 'mongodb'

/**
 * Updates a TV episode in the flat database structure
 * @param {Object} client - MongoDB client
 * @param {string} showTitle - TV show title
 * @param {number} seasonNumber - Season number
 * @param {number} episodeNumber - Episode number
 * @param {Object} updates - Update operations
 * @returns {Promise<Object>} Update result
 */
export async function updateEpisodeInFlatDB(
  client,
  showTitle,
  seasonNumber,
  episodeNumber,
  updates
) {
  try {
    // First, get the TV show ID
    const tvShow = await client
      .db('Media')
      .collection('FlatTVShows')
      .findOne({ title: showTitle }, { projection: { _id: 1 } })

    if (!tvShow) {
      throw new Error(`TV show "${showTitle}" not found in flat structure`)
    }

    // Then, get the season ID
    const season = await client
      .db('Media')
      .collection('FlatSeasons')
      .findOne(
        {
          showId: tvShow._id,
          seasonNumber: seasonNumber,
        },
        { projection: { _id: 1 } }
      )

    if (!season) {
      throw new Error(`Season ${seasonNumber} of "${showTitle}" not found in flat structure`)
    }

    // Always ensure we're using the correct showId and seasonId in updates
    if (updates.$set) {
      updates.$set.showId = tvShow._id
      updates.$set.seasonId = season._id
    }

    const result = await client.db('Media').collection('FlatEpisodes').updateOne(
      {
        showId: tvShow._id,
        seasonId: season._id,
        episodeNumber: episodeNumber,
      },
      updates,
      { upsert: true }
    )

    return result
  } catch (error) {
    console.error(
      `Error updating episode ${episodeNumber} of season ${seasonNumber} of "${showTitle}" in flat structure:`,
      error
    )
    return { error }
  }
}

/**
 * Gets a TV episode from the flat database structure
 * @param {Object} client - MongoDB client
 * @param {string} showTitle - TV show title
 * @param {number} seasonNumber - Season number
 * @param {number} episodeNumber - Episode number
 * @param {boolean} forceOriginalTitleLookup - Force lookup by original title
 * @returns {Promise<Object|null>} Episode document or null
 */
export async function getEpisodeFromFlatDB(
  client,
  showTitle,
  seasonNumber,
  episodeNumber,
  forceOriginalTitleLookup = false
) {
  try {
    const lookupQuery = forceOriginalTitleLookup
      ? { originalTitle: showTitle }
      : { title: showTitle }
    // First, get the TV show ID
    const tvShow = await client
      .db('Media')
      .collection('FlatTVShows')
      .findOne(lookupQuery, { projection: { _id: 1, title: 1 } })

    if (!tvShow) {
      return null
    }

    // Then, get the season ID
    const season = await client
      .db('Media')
      .collection('FlatSeasons')
      .findOne(
        {
          showId: tvShow._id,
          seasonNumber: seasonNumber,
        },
        { projection: { _id: 1 } }
      )

    if (!season) {
      return null
    }

    // First try to find the episode using the official IDs (primary index)
    const episodeByIds = await client.db('Media').collection('FlatEpisodes').findOne({
      showId: tvShow._id,
      seasonId: season._id,
      episodeNumber: episodeNumber,
    })

    if (episodeByIds) {
      return episodeByIds
    }

    // If not found by ID, check if there's an episode with this natural key but mismatched IDs
    const episodeByNaturalKey = await client.db('Media').collection('FlatEpisodes').findOne({
      showTitle: tvShow.title,
      seasonNumber: seasonNumber,
      episodeNumber: episodeNumber,
    })

    // If we found an episode with mismatched IDs, update it to have correct IDs
    // This prevents duplicates in our database
    if (episodeByNaturalKey) {
      // Update the episode to have correct IDs (which are the source of truth)
      await client
        .db('Media')
        .collection('FlatEpisodes')
        .updateOne(
          { _id: episodeByNaturalKey._id },
          {
            $set: {
              showId: tvShow._id,
              seasonId: season._id,
            },
          }
        )

      // Return the episode with updated IDs
      return {
        ...episodeByNaturalKey,
        showId: tvShow._id,
        seasonId: season._id,
      }
    }

    // Episode not found by any means
    return null
  } catch (error) {
    console.error(
      `Error getting episode ${episodeNumber} of season ${seasonNumber} of "${showTitle}" from flat structure:`,
      error
    )
    return null
  }
}

/**
 * Gets a TV episode by ID from the flat database structure
 * @param {Object} client - MongoDB client
 * @param {ObjectId} id - Episode ID
 * @returns {Promise<Object|null>} Episode document or null
 */
export async function getEpisodeByIdFromFlatDB(client, id) {
  try {
    return await client.db('Media').collection('FlatEpisodes').findOne({ _id: id })
  } catch (error) {
    console.error(`Error getting episode by ID "${id}" from flat structure:`, error)
    return null
  }
}

/**
 * Creates or updates a TV episode in the flat database structure
 * First checks if episode exists by {showTitle, seasonNumber, episodeNumber}
 * and updates it if it does, or creates a new one if it doesn't.
 * Always ensures the correct showId and seasonId are used.
 *
 * @param {Object} client - MongoDB client
 * @param {Object} episodeData - Episode data
 * @returns {Promise<Object>} Operation result
 */
export async function createEpisodeInFlatDB(client, episodeData) {
  try {
    // Ensure required fields are present
    if (!episodeData.showTitle || !episodeData.seasonNumber || !episodeData.episodeNumber) {
      throw new Error('Missing required fields: showTitle, seasonNumber, or episodeNumber')
    }

    // Check if episode already exists - this function will handle ID correction
    // and fix any mismatched IDs without requiring additional database calls later
    const existingEpisode = await getEpisodeFromFlatDB(
      client,
      episodeData.showTitle,
      episodeData.seasonNumber,
      episodeData.episodeNumber
    )

    // If episode already exists, update it
    if (existingEpisode) {
      console.log(
        `Episode ${episodeData.showTitle} S${episodeData.seasonNumber}E${episodeData.episodeNumber} already exists, updating instead of creating`
      )

      // Keep the existing _id
      const { _id, ...updateFields } = episodeData
      updateFields.showId = existingEpisode.showId // Ensure consistency with IDs
      updateFields.seasonId = existingEpisode.seasonId

      // Update the episode
      const result = await client
        .db('Media')
        .collection('FlatEpisodes')
        .updateOne({ _id: existingEpisode._id }, { $set: updateFields })

      return {
        ...result,
        upsertedId: existingEpisode._id,
        acknowledged: true,
        matchedCount: 1,
        modifiedCount: result.modifiedCount,
        upsertedCount: 0,
        existing: true,
      }
    }

    // Episode doesn't exist, create a new one
    // Ensure the episode has a type
    if (!episodeData.type) {
      episodeData.type = 'episode'
    }

    // Double check we have the correct showId and seasonId
    // This should already be set by the calling function, but just to be safe
    if (!episodeData.showId || !episodeData.seasonId) {
      console.log(
        `Warning: Episode ${episodeData.showTitle} S${episodeData.seasonNumber}E${episodeData.episodeNumber} missing IDs, will be looked up`
      )

      // Get correct IDs if needed
      const show = await client
        .db('Media')
        .collection('FlatTVShows')
        .findOne({ title: episodeData.showTitle }, { projection: { _id: 1 } })

      if (!show) {
        throw new Error(`TV show "${episodeData.showTitle}" not found in flat structure`)
      }

      const season = await client
        .db('Media')
        .collection('FlatSeasons')
        .findOne(
          {
            showId: show._id,
            seasonNumber: episodeData.seasonNumber,
          },
          { projection: { _id: 1 } }
        )

      if (!season) {
        throw new Error(
          `Season ${episodeData.seasonNumber} of "${episodeData.showTitle}" not found in flat structure`
        )
      }

      episodeData.showId = show._id
      episodeData.seasonId = season._id
    }

    const result = await client.db('Media').collection('FlatEpisodes').insertOne(episodeData)

    return {
      ...result,
      existing: false,
    }
  } catch (error) {
    console.error(
      `Error creating/updating episode ${episodeData.episodeNumber} of season ID "${episodeData.seasonId}" in flat structure:`,
      error
    )
    return { error }
  }
}

/**
 * Updates only the show titles for a TV episode in the flat database structure
 * @param {Object} client - MongoDB client
 * @param {string} showTitle - TV show title
 * @param {number} seasonNumber - Season number
 * @param {number} episodeNumber - Episode number
 * @param {string} showOriginalTitle - The new original show title to set
 * @returns {Promise<Object>} Update result
 */
export async function updateEpisodeShowTitles(
  client,
  showTitle,
  seasonNumber,
  episodeNumber,
  showOriginalTitle
) {
  try {
    if (!showTitle || !showOriginalTitle) {
      throw new Error('Cannot update episode with null showTitle or showOriginalTitle')
    }

    const result = await client
      .db('Media')
      .collection('FlatEpisodes')
      .updateOne(
        {
          // find by show title or original title
          $or: [{ showTitle: showTitle }, { showTitle: showOriginalTitle }],
          seasonNumber: seasonNumber,
          episodeNumber: episodeNumber,
        },
        {
          $set: {
            showTitle: showTitle,
          },
        }
      )

    if (result.matchedCount === 0) {
      console.warn(
        `No episode found for "${showTitle}" S${seasonNumber}E${episodeNumber} to update IDs`
      )
    } else {
      console.log(`Updated IDs for "${showTitle}" S${seasonNumber}E${episodeNumber}`)
    }

    return result
  } catch (error) {
    console.error(
      `Error updating IDs for episode ${episodeNumber} of season ${seasonNumber} of "${showTitle}":`,
      error
    )
    return { error }
  }
}

/**
 * Updates only the showId and seasonId for a TV episode in the flat database structure
 * @param {Object} client - MongoDB client
 * @param {string} showTitle - TV show title
 * @param {number} seasonNumber - Season number
 * @param {number} episodeNumber - Episode number
 * @param {ObjectId} newShowId - The new show ID to set
 * @param {ObjectId} newSeasonId - The new season ID to set
 * @returns {Promise<Object>} Update result
 */
export async function updateEpisodeIds(
  client,
  showTitle,
  seasonNumber,
  episodeNumber,
  newShowId,
  newSeasonId
) {
  try {
    if (!showTitle) {
      throw new Error('Cannot update episode with null showTitle')
    }

    // Find and update the episode by natural key (showTitle, seasonNumber, episodeNumber)
    // This prevents duplicate key errors by not using upsert on IDs
    const result = await client
      .db('Media')
      .collection('FlatEpisodes')
      .updateOne(
        {
          showTitle: showTitle,
          seasonNumber: seasonNumber,
          episodeNumber: episodeNumber,
        },
        {
          $set: {
            showId: newShowId,
            seasonId: newSeasonId,
          },
        }
      )

    if (result.matchedCount === 0) {
      console.warn(
        `No episode found for "${showTitle}" S${seasonNumber}E${episodeNumber} to update IDs`
      )
    } else {
      console.log(`Updated IDs for "${showTitle}" S${seasonNumber}E${episodeNumber}`)
    }

    return result
  } catch (error) {
    console.error(
      `Error updating IDs for episode ${episodeNumber} of season ${seasonNumber} of "${showTitle}":`,
      error
    )
    return { error }
  }
}

/**
 * Gets all episodes for a TV season from the flat database structure
 * @param {Object} client - MongoDB client
 * @param {string} showTitle - TV show title
 * @param {number} seasonNumber - Season number
 * @returns {Promise<Array<Object>>} Array of episode documents
 */
export async function getAllEpisodesForSeasonFromFlatDB(client, showTitle, seasonNumber) {
  try {
    // First, get the TV show ID
    const tvShow = await client
      .db('Media')
      .collection('FlatTVShows')
      .findOne({ title: showTitle }, { projection: { _id: 1 } })

    if (!tvShow) {
      return []
    }

    // Then, get the season ID
    const season = await client
      .db('Media')
      .collection('FlatSeasons')
      .findOne(
        {
          showId: tvShow._id,
          seasonNumber: seasonNumber,
        },
        { projection: { _id: 1 } }
      )

    if (!season) {
      return []
    }

    return await client
      .db('Media')
      .collection('FlatEpisodes')
      .find({
        showId: tvShow._id,
        seasonId: season._id,
      })
      .sort({ episodeNumber: 1 })
      .toArray()
  } catch (error) {
    console.error(
      `Error getting all episodes for season ${seasonNumber} of "${showTitle}" from flat structure:`,
      error
    )
    return []
  }
}
