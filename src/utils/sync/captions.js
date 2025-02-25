import { createFullUrl, filterLockedFields, isSourceMatchingServer, isCurrentServerHighestPriorityForField, MediaType } from './utils'
import { updateMediaInDatabase, updateEpisodeInDatabase } from './database'
import clientPromise from '@src/lib/mongodb'
import chalk from 'chalk'
import { isEqual } from 'lodash'

/**
 * Processes caption URLs from subtitles data.
 * @param {Object} subtitlesData - Subtitles data
 * @param {Object} serverConfig - Server configuration
 * @returns {Object|null} Processed caption URLs or null
 */
function processCaptionURLs(subtitlesData, serverConfig) {
  if (!subtitlesData) return null

  const subtitleURLs = Object.entries(subtitlesData).reduce((acc, [langName, subtitleData]) => {
    acc[langName] = {
      srcLang: subtitleData.srcLang,
      url: createFullUrl(subtitleData.url, serverConfig),
      lastModified: subtitleData.lastModified,
      sourceServerId: serverConfig.id,
    }
    return acc
  }, {})

  return Object.fromEntries(sortSubtitleEntries(Object.entries(subtitleURLs)))
}

/**
 * Sorts subtitle entries, prioritizing English subtitles.
 * @param {Array} entries - Subtitle entries
 * @returns {Array} Sorted entries
 */
function sortSubtitleEntries(entries) {
  return entries.sort(([langNameA], [langNameB]) => {
    if (langNameA.toLowerCase().includes('english')) return -1
    if (langNameB.toLowerCase().includes('english')) return 1
    return 0
  })
}

/**
 * Gathers captions for a movie from all servers.
 * @param {Object} movie - Movie object
 * @param {Object} fileServers - File servers data
 * @returns {Object} Aggregated captions
 */
export function gatherMovieCaptionsForAllServers(movie, fileServers) {
  const aggregated = {}

  // Iterate all servers
  for (const [serverId, fileServer] of Object.entries(fileServers)) {
    const serverConfig = {
      id: serverId,
      ...fileServer.config,
    }
    const fileServerMovieData = fileServer.movies?.[movie.title]
    if (!fileServerMovieData?.urls?.subtitles) continue

    const serverCaptions = processCaptionURLs(fileServerMovieData.urls.subtitles, serverConfig)
    if (!serverCaptions) continue

    // Merge these into `aggregated`, respecting priority
    for (const [lang, subObj] of Object.entries(serverCaptions)) {
      const existing = aggregated[lang]
      if (!existing) {
        aggregated[lang] = {
          ...subObj,
          priority: serverConfig.priority,
        }
      } else {
        if (serverConfig.priority < existing.priority) {
          aggregated[lang] = {
            ...subObj,
            priority: serverConfig.priority,
          }
        }
      }
    }
  }

  return aggregated
}

/**
 * Finalizes movie captions in the database.
 * @param {Object} client - Database client
 * @param {Object} movie - Movie object
 * @param {Object} aggregated - Aggregated captions
 * @returns {Promise<boolean>} True if updated
 */
export async function finalizeMovieCaptions(client, movie, aggregated) {
  const finalCaptionURLs = {}
  for (const [lang, captionObj] of Object.entries(aggregated)) {
    finalCaptionURLs[lang] = {
      srcLang: captionObj.srcLang,
      url: captionObj.url,
      lastModified: captionObj.lastModified,
      sourceServerId: captionObj.sourceServerId,
    }
  }

  const currentCaptions = movie.captionURLs || {}

  if (isEqual(currentCaptions, finalCaptionURLs)) return false

  let newCaptionSource = null
  const langKeys = Object.keys(finalCaptionURLs)
  if (langKeys.length > 0) {
    newCaptionSource = finalCaptionURLs[langKeys[0]].sourceServerId
  }

  console.log(`Movie: Updating captions for "${movie.title}" (orphan removal, new data, etc.)`)

  const updateDoc = {
    $set: {
      captionURLs: finalCaptionURLs,
      captionSource: newCaptionSource,
    },
  }

  await updateMediaInDatabase(
    client,
    MediaType.MOVIE,
    movie.title,
    updateDoc,
    newCaptionSource
  )

  return true
}

/**
 * Gathers captions for a TV season from all servers.
 * @param {Object} show - Show object
 * @param {Object} season - Season object
 * @param {Object} fileServers - File servers data
 * @returns {Object} Aggregated captions
 */
export function gatherSeasonCaptionsForAllServers(show, season, fileServers) {
  const aggregatedData = {}

  for (const [serverId, fileServer] of Object.entries(fileServers)) {
    const serverConfig = {
      id: serverId,
      ...fileServer.config,
    }
    const fileServerShowData = fileServer.tv?.[show.title]
    if (!fileServerShowData) continue

    const seasonKey = `Season ${season.seasonNumber}`
    const fileServerSeasonData = fileServerShowData.seasons?.[seasonKey]
    if (!fileServerSeasonData) continue

    for (const episode of season.episodes) {
      const episodeNumber = episode.episodeNumber
      const episodeFileName = findEpisodeFileName(
        Object.keys(fileServerSeasonData.episodes || {}),
        season.seasonNumber,
        episodeNumber
      )

      if (!episodeFileName) continue

      const fileServerEpisodeData = fileServerSeasonData.episodes[episodeFileName]
      if (!fileServerEpisodeData?.subtitles) continue

      const captionsOnFileServer = processCaptionURLs(fileServerEpisodeData.subtitles, serverConfig)
      if (!captionsOnFileServer) continue

      if (!aggregatedData[episodeNumber]) {
        aggregatedData[episodeNumber] = {}
      }

      for (const [lang, subObj] of Object.entries(captionsOnFileServer)) {
        const existing = aggregatedData[episodeNumber][lang]
        if (!existing) {
          aggregatedData[episodeNumber][lang] = {
            ...subObj,
            priority: serverConfig.priority
          }
        } else {
          if (serverConfig.priority < existing.priority) {
            aggregatedData[episodeNumber][lang] = {
              ...subObj,
              priority: serverConfig.priority
            }
          }
        }
      }
    }
  }

  return aggregatedData
}

/**
 * Finalizes TV season captions in the database.
 * @param {Object} client - Database client
 * @param {Object} show - Show object
 * @param {Object} season - Season object
 * @param {Object} aggregatedData - Aggregated captions
 * @returns {Promise<void>}
 */
export async function finalizeSeasonCaptions(client, show, season, aggregatedData) {
  for (const episode of season.episodes) {
    const episodeNumber = episode.episodeNumber
    const aggregatedForEpisode = aggregatedData[episodeNumber] || {}

    const finalCaptionURLs = {}
    for (const [lang, capObj] of Object.entries(aggregatedForEpisode)) {
      finalCaptionURLs[lang] = {
        srcLang: capObj.srcLang,
        url: capObj.url,
        lastModified: capObj.lastModified,
        sourceServerId: capObj.sourceServerId,
      }
    }

    const currentCaptions = episode.captionURLs || {}

    if (!isEqual(currentCaptions, finalCaptionURLs)) {
      let newCaptionSource = episode.captionSource
      if (Object.keys(finalCaptionURLs).length > 0) {
        const firstLang = Object.keys(finalCaptionURLs)[0]
        newCaptionSource = finalCaptionURLs[firstLang].sourceServerId
      } else {
        newCaptionSource = null
      }

      const updates = {
        captionURLs: finalCaptionURLs,
        captionSource: newCaptionSource
      }

      await updateEpisodeInDatabase(client, show.title, season.seasonNumber, episodeNumber, {
        set: updates
      })

      console.log(
        `[${show.title}] Season ${season.seasonNumber}, Episode ${episodeNumber} - Updated captions.`
      )
    }
  }
}

/**
 * Syncs captions from server to database.
 * @param {Object} currentDB - Current database state
 * @param {Object} fileServer - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Sync results
 */
export async function syncCaptions(currentDB, fileServer, serverConfig, fieldAvailability) {
  const client = await clientPromise
  console.log(chalk.bold.white(`Starting caption sync for server ${serverConfig.id}...`))

  const results = {
    processed: { movies: [], tv: [] },
    errors: { movies: [], tv: [] },
  }

  try {
    // Process movies concurrently
    await Promise.allSettled(
      currentDB.movies.map(async (movie) => {
        try {
          const fileServerMovieData = fileServer?.movies[movie.title]
          if (!fileServerMovieData) return

          const aggregatedCaptions = gatherMovieCaptionsForAllServers(movie, { [serverConfig.id]: fileServer })
          await finalizeMovieCaptions(client, movie, aggregatedCaptions)

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
        for (const season of show.seasons) {
          const aggregatedCaptions = gatherSeasonCaptionsForAllServers(show, season, { [serverConfig.id]: fileServer })
          await finalizeSeasonCaptions(client, show, season, aggregatedCaptions)
        }

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

    console.log(chalk.bold.white(`Finished caption sync for server ${serverConfig.id}`))
    return results
  } catch (error) {
    console.error(`Error during caption sync for server ${serverConfig.id}:`, error)
    throw error
  }
}
