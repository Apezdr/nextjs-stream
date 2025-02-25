import { createFullUrl, filterLockedFields, isSourceMatchingServer, isCurrentServerHighestPriorityForField, MediaType } from './utils'
import { updateMediaInDatabase, updateEpisodeInDatabase } from './database'
import clientPromise from '@src/lib/mongodb'
import chalk from 'chalk'
import { isEqual } from 'lodash'
import { updateMediaUpdates } from '@src/utils/admin_frontend_database'

/**
 * Processes episode thumbnails and blurhash URLs.
 * @param {Object} client - Database client
 * @param {Object} episode - Episode object
 * @param {Object} fileServerEpisodeData - File server episode data
 * @param {string} episodeFileName - Episode file name
 * @param {string} showTitle - Show title
 * @param {number} seasonNumber - Season number
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object|null>} Update data or null
 */
export async function processEpisodeThumbnails(
  client,
  episode,
  fileServerEpisodeData,
  episodeFileName,
  showTitle,
  seasonNumber,
  serverConfig,
  fieldAvailability
) {
  const updates = {}

  // Process thumbnail
  if (fileServerEpisodeData.thumbnail) {
    const newThumbnailUrl = createFullUrl(fileServerEpisodeData.thumbnail, serverConfig)
    if (!episode.thumbnail || episode.thumbnail !== newThumbnailUrl) {
      const fieldPath = `seasons.Season ${seasonNumber}.episodes.${episodeFileName}.thumbnail`

      // Check priority
      const isHighestPriority = isCurrentServerHighestPriorityForField(
        fieldAvailability,
        'tv',
        showTitle,
        fieldPath,
        serverConfig
      )

      if (isHighestPriority) {
        // Verify ownership
        if (!isSourceMatchingServer(episode, 'thumbnailSource', serverConfig) || episode.thumbnail !== newThumbnailUrl) {
          updates.set = {
            thumbnail: newThumbnailUrl,
            thumbnailSource: serverConfig.id,
          }
        }
      }
    }
  }

  // Process thumbnailBlurhash
  if (fileServerEpisodeData.thumbnailBlurhash) {
    const newBlurhashUrl = createFullUrl(fileServerEpisodeData.thumbnailBlurhash, serverConfig)
    if (!episode.thumbnailBlurhash || episode.thumbnailBlurhash !== newBlurhashUrl) {
      const fieldPath = `seasons.Season ${seasonNumber}.episodes.${episodeFileName}.thumbnailBlurhash`

      // Check priority
      const isHighestPriority = isCurrentServerHighestPriorityForField(
        fieldAvailability,
        'tv',
        showTitle,
        fieldPath,
        serverConfig
      )

      if (isHighestPriority) {
        // Verify ownership
        if (
          episode.thumbnailBlurhash !== newBlurhashUrl ||
          isSourceMatchingServer(episode, 'thumbnailBlurhashSource', serverConfig)
        ) {
          updates.set = {
            thumbnailBlurhash: newBlurhashUrl,
            thumbnailBlurhashSource: serverConfig.id
          }
        }
      }
    }
  }

  // Handle removal of thumbnailBlurhash if not provided
  if (
    !fileServerEpisodeData.thumbnailBlurhash && episode.thumbnailBlurhash
  ) {
    const fieldPath = `seasons.Season ${seasonNumber}.episodes.${episodeFileName}.thumbnailBlurhash`
    const isHighestPriority = isCurrentServerHighestPriorityForField(
      fieldAvailability,
      'tv',
      showTitle,
      fieldPath,
      serverConfig
    )

    if (isHighestPriority) {
      updates.unset = { thumbnailBlurhash: '', thumbnailBlurhashSource: '' }
      console.log(
        `Removing thumbnailBlurhash for "${showTitle}" S${seasonNumber}E${episode.episodeNumber} from server ${serverConfig.id}`
      )
    }
  }

  // Handle removal of thumbnail if not provided
  if (
    !fileServerEpisodeData.thumbnail &&
    episode.thumbnail &&
    isSourceMatchingServer(episode, 'thumbnailSource', serverConfig)
  ) {
    const fieldPath = `seasons.Season ${seasonNumber}.episodes.${episodeFileName}.thumbnail`
    const isHighestPriority = isCurrentServerHighestPriorityForField(
      fieldAvailability,
      'tv',
      showTitle,
      fieldPath,
      serverConfig
    )

    if (isHighestPriority) {
      updates.unset = { thumbnail: '', thumbnailSource: '' }
      console.log(
        `Removing thumbnail for "${showTitle}" S${seasonNumber}E${episode.episodeNumber} from server ${serverConfig.id}`
      )
    }
  }

  // Apply updates if any
  if (Object.keys(updates).length > 0) {
    // Filter out any locked fields
    const filteredUpdates = filterLockedFields(episode, updates)

    // If $unset exists in updates, ensure it's preserved
    if (updates.unset) {
      filteredUpdates.unset = updates.unset
    }

    return Object.keys(filteredUpdates).length > 0 ? filteredUpdates : null
  }

  return null
}

/**
 * Processes season thumbnails.
 * @param {Object} client - Database client
 * @param {Object} show - Show object
 * @param {Object} season - Season object
 * @param {Object} fileServerShowData - File server show data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<number>} Number of episodes updated
 */
export async function processSeasonThumbnails(
  client,
  show,
  season,
  fileServerShowData,
  serverConfig,
  fieldAvailability
) {
  const fileServerSeasonData = fileServerShowData.seasons[`Season ${season.seasonNumber}`]
  if (!fileServerSeasonData?.episodes) return 0

  let updatedEpisodes = 0

  await Promise.all(
    season.episodes.map(async (episode) => {
      const episodeFileName = findEpisodeFileName(
        Object.keys(fileServerSeasonData.episodes),
        season.seasonNumber,
        episode.episodeNumber
      )

      if (!episodeFileName) return

      try {
        const updates = await processEpisodeThumbnails(
          client,
          episode,
          fileServerSeasonData.episodes[episodeFileName],
          episodeFileName,
          show.title,
          season.seasonNumber,
          episode.episodeNumber,
          serverConfig,
          fieldAvailability
        )

        if (updates) {
          console.log(
            `TV: Updating thumbnails for "${show.title}" - Season ${season.seasonNumber}, Episode ${episode.episodeNumber} from server ${serverConfig.id}`
          )

          await updateEpisodeInDatabase(
            client,
            show.title,
            season.seasonNumber,
            episode.episodeNumber,
            updates
          )
          updatedEpisodes++
        }
      } catch (error) {
        console.error(
          `Error updating thumbnails for "${show.title}" S${season.seasonNumber}E${episode.episodeNumber} from server ${serverConfig.id}:`,
          error
        )
      }
    })
  )

  return updatedEpisodes
}

/**
 * Syncs TV thumbnails from server to database.
 * @param {Object} currentDB - Current database state
 * @param {Object} fileServer - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Sync results
 */
export async function syncTVThumbnails(currentDB, fileServer, serverConfig, fieldAvailability) {
  const client = await clientPromise
  console.log(
    chalk.bold.magentaBright(`Starting TV thumbnail sync for server ${serverConfig.id}...`)
  )

  const results = {
    processed: { tv: [] },
    errors: { tv: [] },
  }

  try {
    // Process each TV show
    for (const show of currentDB.tv) {
      const fileServerShowData = fileServer?.tv[show.title]
      if (!fileServerShowData) continue

      try {
        let updatedEpisodes = 0

        // Process each season
        for (const season of show.seasons) {
          const seasonUpdates = await processSeasonThumbnails(
            client,
            show,
            season,
            fileServerShowData,
            serverConfig,
            fieldAvailability
          )

          if (seasonUpdates > 0) {
            updatedEpisodes += seasonUpdates
          }
        }

        if (updatedEpisodes > 0) {
          results.processed.tv.push({
            title: show.title,
            serverId: serverConfig.id,
            updatedEpisodes,
          })
        }
      } catch (error) {
        results.errors.tv.push({
          title: show.title,
          serverId: serverConfig.id,
          error: error.message,
        })
      }
    }

    console.log(
      chalk.bold.magentaBright(`TV thumbnail sync complete for server ${serverConfig.id}.`)
    )
    return results
  } catch (error) {
    console.error(`Error during TV thumbnail sync for server ${serverConfig.id}:`, error)
    throw error
  }
}
