import { createFullUrl, filterLockedFields, isSourceMatchingServer, isCurrentServerHighestPriorityForField, MediaType } from './utils'
import { isEqual } from 'lodash'
import { updateMediaInDatabase } from './database'
import clientPromise from '@src/lib/mongodb'
import chalk from 'chalk'
import { updateMediaUpdates } from '@src/utils/admin_frontend_database'

/**
 * Processes blurhash update for a TV season.
 * @param {Object} client - Database client
 * @param {Object} season - Season object
 * @param {Object} fileServerSeasonData - File server season data
 * @param {string} showTitle - Show title
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<boolean|null>} True if updated, null if skipped
 */
export async function processSeasonBlurhash(
  client,
  season,
  fileServerSeasonData,
  showTitle,
  serverConfig,
  fieldAvailability
) {
  if (!fileServerSeasonData) return null

  const seasonNumber = season.seasonNumber
  const fieldPath = `seasons.Season ${seasonNumber}.seasonPosterBlurhash`

  // Check if the current server is the highest priority for the 'seasonPosterBlurhash' field
  const isHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'tv',
    showTitle,
    fieldPath,
    serverConfig
  )

  if (!isHighestPriority) return null

  let needsUpdate = false
  let updatedSeason = { ...season }

  if (fileServerSeasonData.seasonPosterBlurhash) {
    const newBlurhashUrl = createFullUrl(fileServerSeasonData.seasonPosterBlurhash, serverConfig)

    if (
      !season.seasonPosterBlurhashSource ||
      !isEqual(season.seasonPosterBlurhash, newBlurhashUrl)
    ) {
      console.log(
        `TV Season: Updating seasonPosterBlurhash for "${showTitle}" Season ${seasonNumber} from server ${serverConfig.id}`
      )
      updatedSeason = {
        ...updatedSeason,
        seasonPosterBlurhash: newBlurhashUrl,
        seasonPosterBlurhashSource: serverConfig.id,
      }
      needsUpdate = true
    }
  } else if (
    season.seasonPosterBlurhash &&
    isSourceMatchingServer(season, 'seasonPosterBlurhashSource', serverConfig)
  ) {
    delete updatedSeason.seasonPosterBlurhash
    delete updatedSeason.seasonPosterBlurhashSource
    needsUpdate = true
    console.log(
      `TV Season: Removing seasonPosterBlurhash for "${showTitle}" Season ${seasonNumber} from server ${serverConfig.id}`
    )
  }

  if (needsUpdate) {
    // Filter out any locked fields
    const filteredUpdateData = filterLockedFields(season, updatedSeason)

    // Determine whether to set or unset fields
    const setFields = {}
    const unsetFields = {}

    if (filteredUpdateData.seasonPosterBlurhash) {
      setFields['seasons.$[elem].seasonPosterBlurhash'] = filteredUpdateData.seasonPosterBlurhash
      setFields['seasons.$[elem].seasonPosterBlurhashSource'] =
        filteredUpdateData.seasonPosterBlurhashSource
    }

    if (
      !filteredUpdateData.seasonPosterBlurhash &&
      (season.seasonPosterBlurhash || season.seasonPosterBlurhashSource)
    ) {
      unsetFields['seasons.$[elem].seasonPosterBlurhash'] = ''
      unsetFields['seasons.$[elem].seasonPosterBlurhashSource'] = ''
    }

    const updateOperation = {}
    if (Object.keys(setFields).length > 0) {
      updateOperation.$set = setFields
    }
    if (Object.keys(unsetFields).length > 0) {
      updateOperation.$unset = unsetFields
    }

    if (Object.keys(updateOperation).length > 0) {
      try {
        await client
          .db('Media')
          .collection('TV')
          .updateOne({ title: showTitle }, updateOperation, {
            arrayFilters: [{ 'elem.seasonNumber': seasonNumber }],
          })

        await updateMediaUpdates(showTitle, MediaType.TV)
        return true
      } catch (error) {
        console.error(
          `Error updating season_poster for "${showTitle}" Season ${seasonNumber}:`,
          error
        )
      }
    }
  }

  return null
}

/**
 * Processes blurhash update for a TV show.
 * @param {Object} client - Database client
 * @param {Object} show - Show object
 * @param {Object} fileServerData - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<boolean|null>} True if updated, null if skipped
 */
export async function processShowBlurhash(
  client,
  show,
  fileServerData,
  serverConfig,
  fieldAvailability
) {
  if (!fileServerData) return null

  const showTitle = show.title

  const updates = {}
  const unsetFields = {}

  // Process posterBlurhash
  const posterBlurhashFieldPath = 'posterBlurhash'
  const hasPosterBlurhashData = !!fileServerData.posterBlurhash

  const isPosterBlurhashHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'tv',
    show.originalTitle,
    posterBlurhashFieldPath,
    serverConfig
  )

  if (hasPosterBlurhashData && isPosterBlurhashHighestPriority) {
    const newPosterBlurhashURL = createFullUrl(fileServerData.posterBlurhash, serverConfig)

    if (!isEqual(show.posterBlurhash, newPosterBlurhashURL) || !show.posterBlurhashSource) {
      updates.posterBlurhash = newPosterBlurhashURL
      updates.posterBlurhashSource = serverConfig.id
    }
  } else if (
    show.posterBlurhash &&
    isSourceMatchingServer(show, 'posterBlurhashSource', serverConfig)
  ) {
    unsetFields.posterBlurhash = ''
    unsetFields.posterBlurhashSource = ''
  }

  // Process backdropBlurhash
  const backdropBlurhashFieldPath = 'backdropBlurhash'
  const hasBackdropBlurhashData = !!fileServerData.backdropBlurhash

  const isBackdropBlurhashHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'tv',
    show.originalTitle,
    backdropBlurhashFieldPath,
    serverConfig
  )

  if (hasBackdropBlurhashData && isBackdropBlurhashHighestPriority) {
    const newBackdropBlurhashURL = createFullUrl(fileServerData.backdropBlurhash, serverConfig)

    if (!show.backdropBlurhashSource || !isEqual(show.backdropBlurhash, newBackdropBlurhashURL)) {
      updates.backdropBlurhash = newBackdropBlurhashURL
      updates.backdropBlurhashSource = serverConfig.id
    }
  } else if (
    show.backdropBlurhash &&
    isSourceMatchingServer(show, 'backdropBlurhashSource', serverConfig)
  ) {
    unsetFields.backdropBlurhash = ''
    unsetFields.backdropBlurhashSource = ''
  }

  if (Object.keys(updates).length > 0 || Object.keys(unsetFields).length > 0) {
    const updateOperation = {}
    if (Object.keys(updates).length > 0) {
      updateOperation.$set = updates
    }
    if (Object.keys(unsetFields).length > 0) {
      updateOperation.$unset = unsetFields
    }

    // Optionally filter locked fields for $set operations
    if (updateOperation.$set) {
      updateOperation.$set = filterLockedFields(show, updateOperation.$set)
    }

    // Remove empty $set or $unset
    if (updateOperation.$set && Object.keys(updateOperation.$set).length === 0) {
      delete updateOperation.$set
    }
    if (updateOperation.$unset && Object.keys(updateOperation.$unset).length === 0) {
      delete updateOperation.$unset
    }

    if (Object.keys(updateOperation).length > 0) {
      await client.db('Media').collection('TV').updateOne({ title: showTitle }, updateOperation)
      await updateMediaUpdates(showTitle, MediaType.TV)
      return true
    }
  }

  return null
}

/**
 * Processes blurhash update for a movie.
 * @param {Object} client - Database client
 * @param {Object} movie - Movie object
 * @param {Object} fileServerData - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<boolean|null>} True if updated, null if skipped
 */
export async function processMovieBlurhash(
  client,
  movie,
  fileServerData,
  serverConfig,
  fieldAvailability
) {
  if (!fileServerData?.urls?.posterBlurhash) return null

  const fieldPath = 'urls.posterBlurhash'
  const movieTitle = movie.title

  // Check if the current server is the highest priority for the 'urls.posterBlurhash' field
  const isHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'movies',
    movieTitle,
    fieldPath,
    serverConfig
  )

  if (!isHighestPriority) return null

  const newBlurhash = createFullUrl(fileServerData.urls.posterBlurhash, serverConfig)

  if (isSourceMatchingServer(movie, 'posterBlurhashSource', serverConfig) && isEqual(movie.posterBlurhash, newBlurhash)) return null

  const updateData = {
    posterBlurhash: newBlurhash,
    posterBlurhashSource: serverConfig.id,
  }

  // Filter out any locked fields
  const filteredUpdateData = filterLockedFields(movie, updateData)

  if (!filteredUpdateData.posterBlurhash) return null

  console.log(`Movie: Updating posterBlurhash for "${movieTitle}" from server ${serverConfig.id}`)
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
 * Syncs blurhash data from server to database.
 * @param {Object} currentDB - Current database state
 * @param {Object} fileServer - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Sync results
 */
export async function syncBlurhash(currentDB, fileServer, serverConfig, fieldAvailability) {
  const client = await clientPromise
  console.log(chalk.bold.green(`Starting blurhash sync for server ${serverConfig.id}...`))

  const results = {
    processed: { movies: [], tv: [], seasons: [] },
    errors: { movies: [], tv: [], seasons: [] },
  }

  try {
    // Process TV shows concurrently
    await Promise.allSettled(
      currentDB.tv.map(async (show) => {
        try {
          // Process show-level blurhash
          const updatedShow = await processShowBlurhash(
            client,
            show,
            fileServer?.tv[show.title],
            serverConfig,
            fieldAvailability
          )
          if (updatedShow) {
            results.processed.tv.push({
              title: show.title,
              serverId: serverConfig.id,
            })
          }

          // Process blurhash for each season within the show
          await Promise.allSettled(
            show.seasons.map(async (season) => {
              try {
                const updatedSeason = await processSeasonBlurhash(
                  client,
                  season,
                  fileServer?.tv?.[show.title]?.seasons?.[`Season ${season.seasonNumber}`],
                  show.originalTitle,
                  serverConfig,
                  fieldAvailability
                )
                if (updatedSeason) {
                  results.processed.seasons.push({
                    title: show.title,
                    seasonNumber: season.seasonNumber,
                    serverId: serverConfig.id,
                  })
                }
              } catch (seasonError) {
                results.errors.seasons.push({
                  title: show.title,
                  seasonNumber: season.seasonNumber,
                  serverId: serverConfig.id,
                  error: seasonError.message,
                })
              }
            })
          )
        } catch (showError) {
          results.errors.tv.push({
            title: show.title,
            serverId: serverConfig.id,
            error: showError.message,
          })
        }
      })
    )

    // Process movies concurrently
    await Promise.allSettled(
      currentDB.movies.map(async (movie) => {
        try {
          const updated = await processMovieBlurhash(
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
        } catch (movieError) {
          results.errors.movies.push({
            title: movie.title,
            serverId: serverConfig.id,
            error: movieError.message,
          })
        }
      })
    )

    console.log(chalk.bold.green(`Blurhash sync complete for server ${serverConfig.id}`))
    return results
  } catch (error) {
    console.error(`Error during blurhash sync for server ${serverConfig.id}:`, error)
    // Instead of throwing the error, add it to the results and return
    results.errors.general = {
      message: error.message,
      stack: error.stack
    }
    return results
  }
}
