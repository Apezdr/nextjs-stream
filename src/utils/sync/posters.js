import { createFullUrl, filterLockedFields, isSourceMatchingServer, isCurrentServerHighestPriorityForField, MediaType } from './utils'
import { updateMediaInDatabase } from './database'
import clientPromise from '@src/lib/mongodb'
import chalk from 'chalk'
import { isEqual } from 'lodash'
import { updateMediaUpdates } from '@src/utils/admin_frontend_database'

/**
 * Processes show poster URL updates.
 * @param {Object} show - Show object
 * @param {Object} fileServerData - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object|null>} Update data or null
 */
export async function processShowPosterURL(
  show,
  fileServerData,
  serverConfig,
  fieldAvailability
) {
  if (!fileServerData.poster) return null

  const fieldPath = 'poster'
  const showTitle = show.title

  // Check if the current server is the highest priority for the 'poster' field
  const isHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'tv',
    showTitle,
    fieldPath,
    serverConfig
  )

  if (!isHighestPriority) return null

  const newPosterURL = createFullUrl(fileServerData.poster, serverConfig)

  if (isEqual(show.posterURL, newPosterURL) && isSourceMatchingServer(show, 'posterSource', serverConfig))
    return null

  const updateData = {
    poster: newPosterURL,
    posterSource: serverConfig.id,
  }

  // Filter out any locked fields
  const filteredUpdateData = filterLockedFields(show, updateData)

  if (!filteredUpdateData.poster) {
    console.log(`Field "poster" is locked for show "${showTitle}". Skipping poster URL update.`)
    return null
  }

  console.log(`TV: Updating poster URL for "${showTitle}" from server ${serverConfig.id}`)
  return filteredUpdateData
}

/**
 * Processes movie poster URL updates.
 * @param {Object} movie - Movie object
 * @param {Object} fileServerData - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object|null>} Update data or null
 */
export async function processMoviePosterURL(
  movie,
  fileServerData,
  serverConfig,
  fieldAvailability
) {
  if (!fileServerData?.urls?.posterURL) return null

  const fieldPath = 'urls.posterURL'
  const movieTitle = movie.title

  // Check if the current server is the highest priority for the 'urls.posterURL' field
  const isHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'movies',
    movieTitle,
    fieldPath,
    serverConfig
  )

  if (!isHighestPriority) return null

  const newPosterURL = createFullUrl(fileServerData.urls.posterURL, serverConfig)

  if (isEqual(movie.posterURL, newPosterURL) && isSourceMatchingServer(movie, 'posterSource', serverConfig))
    return null

  const updateData = {
    posterURL: newPosterURL,
    posterSource: serverConfig.id,
  }

  // Filter out any locked fields
  const filteredUpdateData = filterLockedFields(movie, updateData)

  if (!filteredUpdateData.posterURL) {
    console.log(`Field "posterURL" is locked for movie "${movieTitle}". Skipping poster URL update.`)
    return null
  }

  console.log(`Movie: Updating poster URL for "${movieTitle}" from server ${serverConfig.id}`)
  return filteredUpdateData
}

/**
 * Processes season poster updates.
 * @param {Object} client - Database client
 * @param {string} showTitle - Show title
 * @param {Array<Object>} seasons - Seasons array
 * @param {Object} fileServerData - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<{ updatedSeasons: Array<Object>, hasUpdates: boolean }>} Update results
 */
export async function processSeasonPosters(
  client,
  showTitle,
  seasons,
  fileServerData,
  serverConfig,
  fieldAvailability
) {
  const updatedSeasons = []
  let hasUpdates = false

  await Promise.all(
    seasons.map(async (season) => {
      const fileServerSeasonData = fileServerData.seasons[`Season ${season.seasonNumber}`]

      // If no data is provided by the file server for this season, skip processing
      if (!fileServerSeasonData) {
        updatedSeasons.push(season)
        return
      }

      // Create a shallow copy of the season to track updates
      let updatedSeason = { ...season }
      let seasonUpdated = false

      // Define the field path for season_poster in fieldAvailability
      const fieldPath = `seasons.Season ${season.seasonNumber}.season_poster`

      // Determine if the current server is the highest priority for the 'season_poster' field
      const isHighestPriority = isCurrentServerHighestPriorityForField(
        fieldAvailability,
        'tv',
        showTitle,
        fieldPath,
        serverConfig
      )

      if (!isHighestPriority) return

      // **1. Handling Setting/Updating season_poster**
      if (fileServerSeasonData.season_poster) {
        const newPosterURL = createFullUrl(fileServerSeasonData.season_poster, serverConfig)
        const differentURL = !isEqual(season.season_poster, newPosterURL)

        if (differentURL) {
          updatedSeason.season_poster = newPosterURL
          updatedSeason.posterSource = serverConfig.id
          seasonUpdated = true
          console.log(
            `Updating season_poster for "${showTitle}" Season ${season.seasonNumber} from server ${serverConfig.id}`
          )
        }
      }
      // **2. Handling Removal of season_poster**
      else if (season.season_poster && isSourceMatchingServer(season, 'posterSource', serverConfig)) {
        delete updatedSeason.season_poster
        delete updatedSeason.posterSource
        seasonUpdated = true
        console.log(
          `Removing season_poster for "${showTitle}" Season ${season.seasonNumber} from server ${serverConfig.id}`
        )
      }

      // If any updates were made, prepare the update operation
      if (seasonUpdated) {
        // **3. Filtering Locked Fields**
        const filteredUpdateData = filterLockedFields(season, updatedSeason)

        // **4. Preparing MongoDB Update Operations**
        const setFields = {}
        const unsetFields = {}

        if (filteredUpdateData.season_poster) {
          setFields['seasons.$[elem].season_poster'] = filteredUpdateData.season_poster
          setFields['seasons.$[elem].posterSource'] = serverConfig.id
        }

        if (
          !filteredUpdateData.season_poster &&
          (season.season_poster || season.posterSource)
        ) {
          unsetFields['seasons.$[elem].season_poster'] = ''
          unsetFields['seasons.$[elem].posterSource'] = ''
        }

        const updateOperation = {}
        if (Object.keys(setFields).length > 0) {
          updateOperation.$set = setFields
        }
        if (Object.keys(unsetFields).length > 0) {
          updateOperation.$unset = unsetFields
        }

        // **5. Executing the Database Update**
        if (Object.keys(updateOperation).length > 0) {
          try {
            await client
              .db('Media')
              .collection('TV')
              .updateOne(
                { title: showTitle },
                updateOperation,
                { arrayFilters: [{ 'elem.seasonNumber': season.seasonNumber }] }
              )

            await updateMediaUpdates(showTitle, MediaType.TV)
            hasUpdates = true
          } catch (error) {
            console.error(
              `Error updating season_poster for "${showTitle}" Season ${season.seasonNumber}:`,
              error
            )
          }
        }
      }

      // Add the updated season to the list
      updatedSeasons.push(updatedSeason)
    })
  )

  return { updatedSeasons, hasUpdates }
}

/**
 * Syncs poster URLs between the current database and file server.
 * @param {Object} currentDB - Current database state
 * @param {Object} fileServer - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Sync results
 */
export async function syncPosterURLs(currentDB, fileServer, serverConfig, fieldAvailability) {
  const client = await clientPromise
  console.log(chalk.bold.magenta(`Starting poster URL sync for server ${serverConfig.id}...`))

  const results = {
    processed: { movies: [], tv: [] },
    errors: { movies: [], tv: [] },
  }

  try {
    // Process TV shows
    for (const show of currentDB.tv) {
      const fileServerShowData = fileServer?.tv[show.title]
      if (!fileServerShowData) continue

      try {
        let updatesMade = false
        const updateData = {}

        // Process show poster
        const showPosterUpdates = await processShowPosterURL(show, fileServerShowData, serverConfig, fieldAvailability)
        if (showPosterUpdates) {
          Object.assign(updateData, showPosterUpdates)
          updatesMade = true
        }

        // Process season posters
        if (show.seasons && fileServerShowData.seasons) {
          const { updatedSeasons, hasUpdates } = await processSeasonPosters(
            client,
            show.title,
            show.seasons,
            fileServerShowData,
            serverConfig,
            fieldAvailability
          )

          if (hasUpdates) {
            updateData.seasons = updatedSeasons
            updatesMade = true
          }
        }

        if (updatesMade) {
          const preparedUpdateData = {
            $set: updateData,
          }
          await updateMediaInDatabase(client, MediaType.TV, show.title, preparedUpdateData, serverConfig.id)
          results.processed.tv.push({
            title: show.title,
            serverId: serverConfig.id,
            updates: Object.keys(updateData),
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

    // Process movies concurrently
    await Promise.allSettled(
      currentDB.movies.map(async (movie) => {
        try {
          const fileServerMovieData = fileServer?.movies[movie.title]
          if (!fileServerMovieData) return

          const posterUpdates = processMoviePosterURL(movie, fileServerMovieData, serverConfig, fieldAvailability)
          if (posterUpdates) {
            const preparedUpdateData = {
              $set: posterUpdates,
            }
            await updateMediaInDatabase(
              client,
              MediaType.MOVIE,
              movie.title,
              preparedUpdateData,
              serverConfig.id
            )
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

    console.log(chalk.bold.magenta(`Poster URL sync complete for server ${serverConfig.id}`))
    return results
  } catch (error) {
    console.error(`Error during poster URL sync for server ${serverConfig.id}:`, error)
    throw error
  }
}
