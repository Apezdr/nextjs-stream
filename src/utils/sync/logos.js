import { createFullUrl, filterLockedFields, isSourceMatchingServer, isCurrentServerHighestPriorityForField, MediaType } from './utils'
import { updateMediaInDatabase } from './database'
import clientPromise from '@src/lib/mongodb'
import chalk from 'chalk'
import { isEqual } from 'lodash'

/**
 * Processes logo update for a TV show.
 * @param {Object} client - Database client
 * @param {Object} show - Show object
 * @param {Object} fileServerData - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<boolean|null>} True if updated, null if skipped
 */
export async function processShowLogo(
  client,
  show,
  fileServerData,
  serverConfig,
  fieldAvailability
) {
  if (!fileServerData?.logo) return null

  const fieldPath = 'logo'
  const showTitle = show.title

  // Check if the current server is the highest priority for the 'logo' field
  const isHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'tv',
    showTitle,
    fieldPath,
    serverConfig
  )

  if (!isHighestPriority) return null

  const newLogoUrl = createFullUrl(fileServerData.logo, serverConfig)

  if (isEqual(show.logo, newLogoUrl) && isSourceMatchingServer(show, 'logoSource', serverConfig))
    return null

  const updateData = {
    logo: newLogoUrl,
    logoSource: serverConfig.id,
  }

  // Filter out any locked fields
  const filteredUpdateData = filterLockedFields(show, updateData)

  if (!filteredUpdateData.logo) {
    console.log(`Field "logo" is locked for show "${showTitle}". Skipping logo update.`)
    return null
  }

  console.log(`TV: Updating logo URL for "${showTitle}" from server ${serverConfig.id}`)
  const preparedUpdateData = {
    $set: filteredUpdateData,
  }
  await updateMediaInDatabase(client, MediaType.TV, showTitle, preparedUpdateData, serverConfig.id)
  return true
}

/**
 * Processes logo update for a movie.
 * @param {Object} client - Database client
 * @param {Object} movie - Movie object
 * @param {Object} fileServerData - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<boolean|null>} True if updated, null if skipped
 */
export async function processMovieLogo(
  client,
  movie,
  fileServerData,
  serverConfig,
  fieldAvailability
) {
  if (!fileServerData?.urls?.logo) return null

  const fieldPath = 'urls.logo'
  const movieTitle = movie.title

  // Check if the current server is the highest priority for the 'urls.logo' field
  const isHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'movies',
    movieTitle,
    fieldPath,
    serverConfig
  )

  if (!isHighestPriority) return null

  const newLogoUrl = createFullUrl(fileServerData.urls.logo, serverConfig)

  if (isEqual(movie.logo, newLogoUrl) && isSourceMatchingServer(movie, 'logoSource', serverConfig))
    return null

  const updateData = {
    logo: newLogoUrl,
    logoSource: serverConfig.id,
  }

  // Filter out any locked fields
  const filteredUpdateData = filterLockedFields(movie, updateData)

  if (!filteredUpdateData.logo) {
    console.log(`Field "logo" is locked for movie "${movieTitle}". Skipping logo update.`)
    return null
  }

  console.log(`Movie: Updating logo URL for "${movieTitle}" from server ${serverConfig.id}`)
  const preparedUpdateData = {
    $set: filteredUpdateData,
  }
  await updateMediaInDatabase(
    client,
    MediaType.MOVIE,
    movieTitle,
    preparedUpdateData,
    serverConfig.id
  )
  return true
}

/**
 * Syncs logos between the current database and file server.
 * @param {Object} currentDB - Current database state
 * @param {Object} fileServer - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Sync results
 */
export async function syncLogos(currentDB, fileServer, serverConfig, fieldAvailability) {
  const client = await clientPromise
  console.log(chalk.bold.yellow(`Starting logo sync for server ${serverConfig.id}...`))

  const results = {
    processed: { movies: [], tv: [] },
    errors: { movies: [], tv: [] },
  }

  try {
    // Process TV shows concurrently
    await Promise.allSettled(
      currentDB.tv.map(async (show) => {
        try {
          const updated = await processShowLogo(
            client,
            show,
            fileServer?.tv[show.title],
            serverConfig,
            fieldAvailability
          )
          if (updated) {
            results.processed.tv.push({
              title: show.title,
              serverId: serverConfig.id,
            })
          }
        } catch (error) {
          results.errors.tv.push({
            title: show.title,
            serverId: serverConfig.id,
            error: error.message,
          })
        }
      })
    )

    // Process movies concurrently
    await Promise.allSettled(
      currentDB.movies.map(async (movie) => {
        try {
          const updated = await processMovieLogo(
            client,
            movie,
            fileServer?.movies[movie.title],
            serverConfig,
            fieldAvailability
          )
          if (updated) {
            results.processed.movies.push({
              title: movie.title,
              serverId: serverConfig.id,
            })
          }
        } catch (error) {
          results.errors.movies.push({
            title: movie.title,
            serverId: serverConfig.id,
            error: error.message,
          })
        }
      })
    )

    console.log(chalk.bold.yellow(`Logo sync complete for server ${serverConfig.id}`))
    return results
  } catch (error) {
    console.error(`Error during logo sync for server ${serverConfig.id}:`, error)
    throw error
  }
}
