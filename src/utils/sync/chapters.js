import { createFullUrl, filterLockedFields, isSourceMatchingServer, isCurrentServerHighestPriorityForField, MediaType, findEpisodeFileName } from './utils'
import { updateMediaInDatabase, updateEpisodeInDatabase } from './database'
import clientPromise from '@src/lib/mongodb'
import chalk from 'chalk'
import { isEqual } from 'lodash'

/**
 * Processes chapter updates for a movie.
 * @param {Object} client - Database client
 * @param {Object} movie - Movie object
 * @param {Object} fileServerMovieData - File server movie data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<boolean>} True if updated
 */
export async function processMovieChapters(
  client,
  movie,
  fileServerMovieData,
  serverConfig,
  fieldAvailability
) {
  const fileServerUrls = fileServerMovieData?.urls || {}

  if (fileServerUrls.chapters) {
    const newChapterUrl = createFullUrl(fileServerUrls.chapters, serverConfig)

    // Check if the current server has the highest priority for chapters
    const isHighestPriority = isCurrentServerHighestPriorityForField(
      fieldAvailability,
      'movies',
      movie.title,
      'urls.chapters',
      null,
      serverConfig
    )

    if (!isHighestPriority) return false

    const hasSameData =
      movie.chapterURL &&
      movie.chapterSource &&
      isEqual(movie.chapterURL, newChapterUrl) &&
      isSourceMatchingServer(movie, 'chapterSource', serverConfig)

    if (!hasSameData) {
      console.log(`Movie: Updating chapters for ${movie.title} from server ${serverConfig.id}`)
      const preparedUpdateData = {
        $set: {
          chapterURL: newChapterUrl,
          chapterSource: serverConfig.id,
        },
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
  } else if (movie.chapterURL && isSourceMatchingServer(movie, 'chapterSource', serverConfig)) {
    console.log(`Movie: Removing chapters for ${movie.title} from server ${serverConfig.id}`)
    await client
      .db('Media')
      .collection('Movies')
      .updateOne(
        { title: movie.title },
        {
          $unset: {
            chapterURL: '',
            chapterSource: '',
          },
        }
      )
    return true
  }
  return false
}

/**
 * Processes chapter updates for a TV episode.
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
async function processEpisodeChapters(
  client,
  episode,
  fileServerEpisodeData,
  episodeFileName,
  showTitle,
  seasonNumber,
  serverConfig,
  fieldAvailability
) {
  if (fileServerEpisodeData?.chapters) {
    const newChapterUrl = createFullUrl(fileServerEpisodeData.chapters, serverConfig)

    // Check if the current server has the highest priority for chapters
    const fieldPath = `seasons.Season ${seasonNumber}.episodes.${episodeFileName}.chapters`
    const isHighestPriority = isCurrentServerHighestPriorityForField(
      fieldAvailability,
      'tv',
      showTitle,
      fieldPath,
      null,
      serverConfig
    )

    if (!isHighestPriority) return null

    const hasSameData =
      episode.chapterURL &&
      episode.chapterSource &&
      isEqual(episode.chapterURL, newChapterUrl) &&
      isSourceMatchingServer(episode, 'chapterSource', serverConfig)

    if (!hasSameData) {
      console.log(
        `TV: Updating chapters for "${showTitle}" Season ${seasonNumber}, Episode ${episode.episodeNumber} from server ${serverConfig.id}`
      )
      return {
        chapterURL: newChapterUrl,
        chapterSource: serverConfig.id,
      }
    }
  } else if (episode.chapterURL && isSourceMatchingServer(episode, 'chapterSource', serverConfig)) {
    console.log(
      `TV: Removing chapters for "${showTitle}" Season ${seasonNumber}, Episode ${episode.episodeNumber} from server ${serverConfig.id}`
    )
    return {
      $unset: {
        chapterURL: '',
        chapterSource: '',
      },
    }
  }
  return null
}

/**
 * Processes chapter updates for a TV season.
 * @param {Object} client - Database client
 * @param {Object} show - Show object
 * @param {Object} season - Season object
 * @param {Object} fileServerShowData - File server show data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<number>} Number of episodes updated
 */
export async function processSeasonChapters(
  client,
  show,
  season,
  fileServerShowData,
  serverConfig,
  fieldAvailability
) {
  const fileServerSeasonData = fileServerShowData.seasons[`Season ${season.seasonNumber}`] || {
    urls: {},
  }

  const updates = []
  for (const episode of season.episodes) {
    const episodeFileName = findEpisodeFileName(
      Object.keys(fileServerSeasonData.episodes),
      season.seasonNumber,
      episode.episodeNumber
    )

    const fileServerEpisodeData = episodeFileName
      ? fileServerSeasonData.episodes[episodeFileName]
      : null

    const chapterUpdates = await processEpisodeChapters(
      client,
      episode,
      fileServerEpisodeData,
      episodeFileName,
      show.title,
      season.seasonNumber,
      serverConfig,
      fieldAvailability
    )

    if (chapterUpdates) {
      updates.push({
        episodeNumber: episode.episodeNumber,
        updates: chapterUpdates,
      })
    }
  }

  // Apply updates
  for (const update of updates) {
    await updateEpisodeInDatabase(
      client,
      show.title,
      season.seasonNumber,
      update.episodeNumber,
      update.updates
    )
  }

  return updates.length
}

/**
 * Syncs chapter information from server to database.
 * @param {Object} currentDB - Current database state
 * @param {Object} fileServer - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Sync results
 */
export async function syncChapters(currentDB, fileServer, serverConfig, fieldAvailability) {
  const client = await clientPromise
  console.log(chalk.bold.blue(`Starting chapter sync for server ${serverConfig.id}...`))

  const results = {
    processed: { movies: [], tv: [] },
    errors: { movies: [], tv: [] },
  }

  try {
    // Process movies concurrently
    await Promise.allSettled(
      currentDB.movies.map(async (movie) => {
        const fileServerMovieData = fileServer?.movies[movie.title]
        if (!fileServerMovieData) return

        try {
          await processMovieChapters(client, movie, fileServerMovieData, serverConfig, fieldAvailability)
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
      const fileServerShowData = fileServer?.tv[show.title] || null

      // In multi-server it's fairly common for a show to be missing from one server,
      // so we'll just skip it if it's not there
      if (!fileServerShowData) continue

      try {
        // Process seasons concurrently
        await Promise.allSettled(
          show.seasons.map(async (season) => {
            try {
              await processSeasonChapters(client, show, season, fileServerShowData, serverConfig, fieldAvailability)
              return { success: true, seasonNumber: season.seasonNumber }
            } catch (error) {
              return {
                success: false,
                seasonNumber: season.seasonNumber,
                error: error.message,
              }
            }
          })
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

    console.log(chalk.bold.blue(`Finished chapter sync for server ${serverConfig.id}`))
    return results
  } catch (error) {
    console.error(`Error during chapter sync for server ${serverConfig.id}:`, error)
    // Instead of throwing the error, add it to the results and return
    results.errors.general = {
      message: error.message,
      stack: error.stack
    }
    return results
  }
}
