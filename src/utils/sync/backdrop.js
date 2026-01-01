import { createFullUrl, filterLockedFields, isSourceMatchingServer, isCurrentServerHighestPriorityForField, MediaType } from './utils'
import { isEqual } from 'lodash'
import { updateMediaInDatabase } from './database'
import clientPromise from '@src/lib/mongodb'
import chalk from 'chalk'

/**
 * Processes backdrop updates for media items (TV shows or movies).
 * @param {Object} media - Media object (TV show or movie)
 * @param {Object} fileServerData - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Object|null} Update data or null
 */
export function processBackdropUpdates(media, fileServerData, serverConfig, fieldAvailability) {
  const updates = {}
  const fileServerUrls = fileServerData?.urls || fileServerData?.episodes || fileServerData

  const mediaType = media.type === 'movie' ? 'movies' : 'tv'
  const mediaTitle = media.title

  // Determine if current server is top priority for 'backdrop'
  const backdropFieldPath = mediaType === 'movies' ? 'urls.backdrop' : 'backdrop'
  const backdropIsHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    mediaType,
    media.originalTitle,
    backdropFieldPath,
    serverConfig
  )

  // Process main backdrop
  if (fileServerUrls.backdrop) {
    if (backdropIsHighestPriority) {
      const newBackdropUrl = createFullUrl(fileServerUrls.backdrop, serverConfig)
      if (
        !media.backdropSource ||
        !isEqual(media.backdrop, newBackdropUrl) ||
        !isSourceMatchingServer(media, 'backdropSource', serverConfig)
      ) {
        updates.backdrop = newBackdropUrl
        updates.backdropSource = serverConfig.id
      }
    }
  } else if (media.backdrop && isSourceMatchingServer(media, 'backdropSource', serverConfig)) {
    // Remove backdrop if not provided by this server anymore and still highest priority
    if (backdropIsHighestPriority) {
      updates.$unset = { backdrop: '', backdropSource: '' }
      console.log(`Removing backdrop for "${mediaTitle}" from server ${serverConfig.id}`)
    }
  }

  // Determine if current server is top priority for 'backdropBlurhash'
  const backdropBlurhashFieldPath =
    mediaType === 'movies' ? 'urls.backdropBlurhash' : 'backdropBlurhash'
  const blurhashIsHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    mediaType,
    media.originalTitle,
    backdropBlurhashFieldPath,
    serverConfig
  )

  // Process backdrop blurhash
  if (fileServerUrls.backdropBlurhash) {
    if (blurhashIsHighestPriority) {
      const newBlurhashUrl = createFullUrl(fileServerUrls.backdropBlurhash, serverConfig)
      if (
        !media.backdropBlurhashSource ||
        !isEqual(media.backdropBlurhash, newBlurhashUrl) ||
        !isSourceMatchingServer(media, 'backdropBlurhashSource', serverConfig)
      ) {
        if (
          !media.backdropBlurhash ||
          !isEqual(media.backdropBlurhash, newBlurhashUrl) ||
          !isSourceMatchingServer(media, 'backdropBlurhashSource', serverConfig)
        ) {
          updates.backdropBlurhash = newBlurhashUrl
          updates.backdropBlurhashSource = serverConfig.id
        }
      }
    }
  } else if (
    media.backdropBlurhash &&
    isSourceMatchingServer(media, 'backdropBlurhashSource', serverConfig)
  ) {
    if (blurhashIsHighestPriority) {
      if (!updates.$unset) updates.$unset = {}
      updates.$unset.backdropBlurhash = ''
      updates.$unset.backdropBlurhashSource = ''
      console.log(`Removing backdropBlurhash for "${mediaTitle}" from server ${serverConfig.id}`)
    }
  }

  if (Object.keys(updates).length === 0) {
    return null
  }

  // Filter out locked fields
  const filteredUpdates = filterLockedFields(media, updates)

  // Preserve $unset if present
  if (updates.$unset) {
    filteredUpdates.$unset = { ...filteredUpdates.$unset, ...updates.$unset }
  }

  // Clean empty operations
  if (filteredUpdates.$set && Object.keys(filteredUpdates.$set).length === 0) {
    delete filteredUpdates.$set
  }
  if (filteredUpdates.$unset && Object.keys(filteredUpdates.$unset).length === 0) {
    delete filteredUpdates.$unset
  }

  // If nothing remains after filtering, return null
  if (Object.keys(filteredUpdates).length === 0) {
    return null
  }

  return filteredUpdates
}

/**
 * Syncs backdrop images for movies and TV shows.
 * @param {Object} currentDB - Current database state
 * @param {Object} fileServer - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Sync results
 */
export async function syncBackdrop(currentDB, fileServer, serverConfig, fieldAvailability) {
  const client = await clientPromise
  console.log(chalk.bold.redBright(`Starting backdrop sync for server ${serverConfig.id}...`))

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
        const backdropUpdates = processBackdropUpdates(
          { type: 'tv', ...show },
          fileServerShowData,
          serverConfig,
          fieldAvailability
        )
        if (backdropUpdates) {
          const updateDoc = {
            $set: {
              backdrop: backdropUpdates.backdrop,
              backdropUpdates: backdropUpdates.backdropSource,
            },
          }
          await updateMediaInDatabase(
            client,
            MediaType.TV,
            show.title,
            updateDoc,
            serverConfig.id
          )
          results.processed.tv.push({
            title: show.title,
            serverId: serverConfig.id,
            updates: Object.keys(backdropUpdates),
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

          const backdropUpdates = processBackdropUpdates(
            { type: 'movie', ...movie },
            fileServerMovieData,
            serverConfig,
            fieldAvailability
          )
          if (backdropUpdates) {
            const updateDoc = {
              $set: {
                backdrop: backdropUpdates.backdrop,
                backdropUpdates: backdropUpdates.backdropSource,
              },
            }
            await updateMediaInDatabase(
              client,
              MediaType.MOVIE,
              movie.title,
              updateDoc,
              serverConfig.id
            )
            results.processed.movies.push({
              title: movie.title,
              serverId: serverConfig.id,
              updates: Object.keys(backdropUpdates),
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

    console.log(chalk.bold.redBright(`Backdrop sync complete for server ${serverConfig.id}`))
    return results
  } catch (error) {
    console.error(`Error during backdrop sync for server ${serverConfig.id}:`, error)
    // Instead of throwing the error, add it to the results and return
    results.errors.general = {
      message: error.message,
      stack: error.stack
    }
    return results
  }
}
