import { createFullUrl, filterLockedFields, isSourceMatchingServer, isCurrentServerHighestPriorityForField, MediaType } from './utils'
import { updateMediaInDatabase, updateEpisodeInDatabase } from './database'
import clientPromise from '@src/lib/mongodb'
import chalk from 'chalk'
import { isEqual } from 'lodash'

/**
 * Processes video URL update for a movie.
 * @param {Object} client - Database client
 * @param {Object} movie - Movie object
 * @param {Object} fileServerData - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<boolean|null>} True if updated, null if skipped
 */
export async function processMovieVideoURL(
  client,
  movie,
  fileServerData,
  serverConfig,
  fieldAvailability
) {
  if (!fileServerData) {
    throw new Error(`Movie "${movie.title}" not found on server ${serverConfig.id}`)
  }

  if (!fileServerData.urls?.mp4) {
    throw new Error(
      `No MP4 video URL found for movie "${movie.title}" on server ${serverConfig.id}`
    )
  }

  // Construct the field path for the movie video URL
  const fieldPath = 'urls.mp4'

  // Check if the current server has the highest priority for videoURL
  const isHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'movies',
    movie.title,
    fieldPath,
    serverConfig
  )

  if (!isHighestPriority) return null

  const newVideoURL = createFullUrl(fileServerData.urls.mp4, serverConfig)
  const hasSameData =
    movie.videoURL &&
    isEqual(movie.videoURL, newVideoURL) &&
    isSourceMatchingServer(movie, 'videoSource', serverConfig)
  if (hasSameData) return null

  const updateData = {
    videoURL: newVideoURL,
    videoSource: serverConfig.id,
  }
  const filteredUpdateData = filterLockedFields(movie, updateData)

  if (!filteredUpdateData.videoURL) {
    console.log(`Field "videoURL" is locked for movie "${movie.title}". Skipping video URL update.`)
    return null
  }

  console.log(`Movie: Updating video URL for "${movie.title}" from server ${serverConfig.id}`)
  const preparedUpdateData = {
    $set: filteredUpdateData,
  }
  await updateMediaInDatabase(
    client,
    MediaType.MOVIE,
    movie.title,
    preparedUpdateData,
    serverConfig.id
  )
  return true
}

/**
 * Processes video URL update for a TV episode.
 * @param {Object} episode - Episode object
 * @param {Object} fileServerEpisodeData - File server episode data
 * @param {string} episodeFileName - Episode file name
 * @param {string} showTitle - Show title
 * @param {number} seasonNumber - Season number
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object|null>} Update data or null
 */
export async function processEpisodeVideoURL(
  episode,
  fileServerEpisodeData,
  episodeFileName,
  showTitle,
  seasonNumber,
  serverConfig,
  fieldAvailability
) {
  // Construct the field path for the episode video URL
  const fieldPath = `seasons.Season ${seasonNumber}.episodes.${episodeFileName}.videoURL`

  // Check if the current server has the highest priority for videoURL
  const isHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'tv',
    showTitle,
    fieldPath,
    serverConfig
  )

  if (!isHighestPriority) return null

  const setFields = {}
  const unsetFields = []

  const newVideoURL = createFullUrl(fileServerEpisodeData.videoURL, serverConfig)
  if (!isEqual(episode.videoURL, newVideoURL)) {
    setFields.videoURL = newVideoURL
    setFields.videoSource = serverConfig.id
  }

  if (Object.keys(setFields).length > 0 || unsetFields.length > 0) {
    const updates = {}
    if (Object.keys(setFields).length > 0) {
      updates.set = setFields
    }
    if (unsetFields.length > 0) {
      updates.unset = unsetFields
    }
    console.log(
      `TV: Updating video URL for "${showTitle}" - Season ${seasonNumber}, Episode ${episode.episodeNumber} from server ${serverConfig.id}`
    )
    return updates
  }

  return null
}

/**
 * Processes video URL updates for a TV season.
 * @param {Object} client - Database client
 * @param {Object} show - Show object
 * @param {Object} season - Season object
 * @param {Object} fileServerShowData - File server show data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<number>} Number of episodes updated
 */
export async function processSeasonVideoURLs(
  client,
  show,
  season,
  fileServerShowData,
  serverConfig,
  fieldAvailability
) {
  const fileServerSeasonData = fileServerShowData.seasons[`Season ${season.seasonNumber}`]
  if (!fileServerSeasonData) {
    throw new Error(
      `Season ${season.seasonNumber} for TV show "${show.title}" not found on server ${serverConfig.id}`
    )
  }

  const updates = []
  for (const episode of season.episodes) {
    const episodeFileName = findEpisodeFileName(
      Object.keys(fileServerSeasonData.episodes),
      season.seasonNumber,
      episode.episodeNumber
    )

    if (!episodeFileName) continue

    const fileServerEpisodeData = fileServerSeasonData.episodes[episodeFileName]
    const videoUpdates = await processEpisodeVideoURL(
      episode,
      fileServerEpisodeData,
      episodeFileName,
      show.title,
      season.seasonNumber,
      serverConfig,
      fieldAvailability
    )

    if (videoUpdates) {
      updates.push({
        episodeNumber: episode.episodeNumber,
        updates: videoUpdates
      })
    }
  }

  // Process all updates
  for (const update of updates) {
    await updateEpisodeInDatabase(
      client,
      show.title,
      season.seasonNumber,
      update.episodeNumber,
      update.updates
    )
  }

  if (updates.length > 0) {
    await updateMediaUpdates(show.title, MediaType.TV)
  }

  return updates.length
}

/**
 * Syncs video URLs from server to database.
 * @param {Object} currentDB - Current database state
 * @param {Object} fileServer - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Sync results
 */
export async function syncVideoURL(currentDB, fileServer, serverConfig, fieldAvailability) {
  const client = await clientPromise
  console.log(chalk.bold.blueBright(`Starting video URL sync for server ${serverConfig.id}...`))

  const results = {
    processed: { movies: [], tv: [] },
    errors: { movies: [], tv: [] },
  }

  try {
    // Process movies concurrently
    await Promise.allSettled(
      currentDB.movies.map(async (movie) => {
        try {
          await processMovieVideoURL(client, movie, fileServer?.movies[movie.title], serverConfig, fieldAvailability)
          results.processed.movies.push({
            title: movie.title,
            serverId: serverConfig.id,
          })
        } catch (error) {
          results.errors.movies.push({
            title: movie.title,
            serverId: serverConfig.id,
            error: error.message,
          })
        }
      })
    )

    // Process TV shows
    for (const show of currentDB.tv) {
      const fileServerShowData = fileServer?.tv[show.title]
      if (!fileServerShowData) continue

      try {
        // Process seasons concurrently
        await Promise.allSettled(
          show.seasons.map((season) =>
            processSeasonVideoURLs(client, show, season, fileServerShowData, serverConfig, fieldAvailability)
          )
        )

        results.processed.tv.push({
          title: show.title,
          serverId: serverConfig.id,
          seasons: show.seasons.length,
        })
      } catch (error) {
        results.errors.tv.push({
          title: show.title,
          serverId: serverConfig.id,
          error: error.message,
        })
      }
    }

    console.log(chalk.bold.blueBright(`Video URL sync complete for server ${serverConfig.id}`))
    return results
  } catch (error) {
    console.error(`Error during video URL sync for server ${serverConfig.id}:`, error)
    throw error
  }
}
