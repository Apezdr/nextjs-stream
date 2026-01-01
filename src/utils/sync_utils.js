import { isEqual } from 'lodash'
import { updateMediaUpdates } from './admin_frontend_database'
import { fetchMetadataMultiServer } from './admin_utils'
import pLimit from 'p-limit'
import { createFullUrl, extractEpisodeDetails, findEpisodeFileName, isCurrentServerHighestPriorityForField, isSourceMatchingServer, matchEpisodeFileName, MediaType, processCaptionURLs } from './sync/utils'
import { extractSeasonInfo, processMovieData, processShowData } from './sync/fileServer'
import { updateEpisodeInDatabase, updateMediaInDatabase } from './sync/database'
import { sortSubtitleEntries } from './sync/captions'
const CONCURRENCY_LIMIT = 10; // Adjust based on your system's capacity
const limit = pLimit(CONCURRENCY_LIMIT);

// ==========================================
// Media Processing
// ==========================================

export async function addOrUpdateSeason(
  currentShow,
  seasonInfo,
  showTitle,
  fileServer,
  showMetadata,
  serverConfig
) {
  const { number, seasonIdentifier, season_poster, seasonPosterBlurhash, episodes } =
    extractSeasonInfo(seasonInfo, showTitle, fileServer, serverConfig)

  if (episodes && episodes.length > 0) {
    // Find or initialize the season in currentShow
    let currentSeason = currentShow.seasons.find((s) => s.seasonNumber === number)
    if (!currentSeason) {
      currentSeason = { seasonNumber: number, episodes: [] }
      currentShow.seasons.push(currentSeason)
      currentShow.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber)
    }

    // Initialize or retrieve season metadata
    let seasonMetadata = showMetadata.seasons.find((s) => s.season_number === number) || {
      episode_count: 0,
      episodes: [],
    }

    // Add in the existing metadata for the season
    seasonMetadata.episodes =
      currentShow.seasons.find((s) => s.seasonNumber === number)?.metadata?.episodes ?? []

    for (const episode of episodes) {
      // Extract episode details
      // Initialize episode number and title
      let { episodeNumber, title } = episode

      // Fetch episode metadata if available
      let episodeMetadata = {}
      if (episode.metadata) {
        try {
          episodeMetadata = await fetchMetadataMultiServer(
            serverConfig.id, // Pass serverId for correct URL handling
            episode.metadata,
            'file',
            'tv',
            showTitle
          )
          // Set title to episode name if available
          title = episodeMetadata?.name || title
          seasonMetadata.episodes = seasonMetadata.episodes || []
          seasonMetadata.episodes.push(episodeMetadata)
        } catch (error) {
          console.error(
            `Error fetching metadata for episode ${episodeNumber} of ${showTitle}:`,
            error
          )
        }
      }

      // Fallback to filename if details are not available from the episode metadata
      // ex. S01E01 - The One Way Trip WEBRip-1080p.mp4 =
      // episodeNumber = 1
      // title = 'The One Way Trip'
      if (!title) {
        const episodeMatch = matchEpisodeFileName(episode.filename)
        if (!episodeMatch) continue
        title = episodeMatch.title
        // Extract episode details from the filename
        const e = extractEpisodeDetails(episodeMatch)
        episodeNumber = e.episodeNumber
        title = e.title
      }

      // Check if the episode already exists
      const existingEpisode = currentSeason.episodes.find((e) => e.episodeNumber === episodeNumber)
      if (!existingEpisode) {
        const season = fileServer.tv[showTitle].seasons[seasonIdentifier]
        // Construct videoURL using the handler
        const videoURL = createFullUrl(episode.videoURL, serverConfig)

        // Initialize updatedData with required fields
        let updatedData = {
          episodeNumber: episodeNumber,
          title: title,
          videoURL: videoURL,
          videoSource: episode.videoSource,
          mediaLastModified: episode.mediaLastModified,
          length: episode.length,
          dimensions: episode.dimensions,
        }

        // Add thumbnail if available
        if (episode.thumbnail) {
          updatedData.thumbnail = createFullUrl(episode.thumbnail, serverConfig)
          updatedData.thumbnailSource = episode.thumbnailSource
        }

        // Add thumbnailBlurhash if available
        if (episode.thumbnailBlurhash) {
          updatedData.thumbnailBlurhash = createFullUrl(episode.thumbnailBlurhash, serverConfig)
          updatedData.thumbnailBlurhashSource = episode.thumbnailBlurhashSource
        }

        // Process captions
        const captions = episode.subtitles
        if (captions) {
          updatedData.captionURLs = {}
          for (const [lang, captionData] of Object.entries(captions)) {
            updatedData.captionURLs[lang] = {
              srcLang: captionData.srcLang,
              url: createFullUrl(captionData.url, serverConfig),
              lastModified: captionData.lastModified,
            }
          }
          updatedData.captionSource = serverConfig.id
        }

        // Add chapterURL if exists
        const chapters = episode.chapters
        if (chapters) {
          updatedData.chapterURL = createFullUrl(chapters, serverConfig)
          updatedData.chapterSource = serverConfig.id
        }

        // Push the new episode to the current season
        currentSeason.episodes.push(updatedData)
      }
    }

    // Sort episodes by episodeNumber
    currentSeason.episodes.sort((a, b) => a.episodeNumber - b.episodeNumber)

    currentSeason.metadata = seasonMetadata
    if (season_poster) {
      currentSeason.season_poster = createFullUrl(season_poster, serverConfig)
      currentSeason.posterSource = serverConfig.id
    }
    if (seasonPosterBlurhash) {
      currentSeason.seasonPosterBlurhash = createFullUrl(seasonPosterBlurhash, serverConfig)
      currentSeason.seasonPosterBlurhashSource = serverConfig.id
    }
  }
}

/**
 * Process TV show with server configuration
 * @param {Object} client - Database client
 * @param {Object} show - Show data
 * @param {Object} fileServer - File server data
 * @param {string} showTitle - Title of the show
 * @param {Object} serverConfig - Server configuration
 */
export async function processTVShow(client, show, fileServer, showTitle, serverConfig) {
  const showData = fileServer?.tv[showTitle]

  if (!showData) {
    console.log(`TV: No data found for ${showTitle} on server ${serverConfig.id}. Skipping.`)
    return
  }

  const showMetadata = await fetchMetadataMultiServer(
    serverConfig.id,
    showData.metadata,
    'file',
    'tv',
    showTitle
  )

  if (!showMetadata) {
    console.log(`TV: No metadata found for ${showTitle} on server ${serverConfig.id}. Skipping.`)
    return
  }

  const currentShow = (await client.db('Media').collection('TV').findOne({ title: showTitle })) || {
    seasons: [],
  }

  // Update all seasons concurrently
  await Promise.all(
    show.seasons.map((seasonInfo) =>
      addOrUpdateSeason(currentShow, seasonInfo, showTitle, fileServer, showMetadata, serverConfig)
    )
  )

  currentShow.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber)

  const showUpdateData = processShowData(showData, showMetadata, currentShow, serverConfig)
  const preparedUpdateData = {
    $set: showUpdateData,
  }

  await updateMediaInDatabase(client, MediaType.TV, showTitle, preparedUpdateData, serverConfig.id)
}

/**
 * Process movie data with server configuration
 * @param {Object} client - Database client
 * @param {string} movieTitle - Title of the movie
 * @param {Object} fileServer - File server data
 * @param {Object} serverConfig - Server configuration
 */
export async function processMovie(client, movieTitle, fileServer, serverConfig) {
  const movieData = fileServer?.movies[movieTitle]

  if (!movieData) {
    console.log(`Movie: No data found for ${movieTitle} on server ${serverConfig.id}. Skipping.`)
    return
  }

  const updateData = await processMovieData(movieTitle, movieData, serverConfig)

  if (!updateData) return

  const preparedUpdateData = {
    $set: updateData,
  }

  await updateMediaInDatabase(
    client,
    MediaType.MOVIE,
    movieTitle,
    preparedUpdateData,
    serverConfig.id
  )
}

/**
 * Processes episode metadata updates
 * @param {Object} episode - Episode data
 * @param {string} episodeFileName - File name of the episode
 * @param {Object} fileServerUrls - URLs from file server
 * @param {Object} currentSeasonData - Current season data
 * @param {string} showTitle - Show title
 * @param {number} seasonNumber - Season number
 * @param {Object} serverConfig - Server configuration
 */
async function processEpisodeMetadata(
  episode,
  episodeFileName,
  fileServerUrls,
  currentSeasonData,
  showTitle,
  seasonNumber,
  serverConfig,
  fieldAvailability
) {
  const episodeData = fileServerUrls[episodeFileName] ?? { metadata: null }

  // Construct the field path for the episode metadata, including the filename
  const fieldPath = `seasons.Season ${seasonNumber}.episodes.${episodeFileName}.metadata`

  // Check if the current server is the highest priority with metadata for this episode
  const isHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'tv',
    showTitle,
    fieldPath,
    serverConfig
  )

  if (!isHighestPriority) {
    // console.log(
    //   `Skipping metadata update for "${showTitle}" Season ${seasonNumber} Episode ${episode.episodeNumber} - higher-priority server has metadata.`
    // )
    return null
  }

  const mostRecent_episodeMetadata = await fetchMetadataMultiServer(
    serverConfig.id,
    episodeData.metadata,
    'file',
    'tv',
    showTitle
  )

  if (!mostRecent_episodeMetadata) {
    console.error(
      `TV: Metadata fetch failed for ${episodeFileName} in "${showTitle}" on server ${serverConfig.id}`,
      episodeData.metadata
    )
    return null
  }

  const currentEpisodeMetadata = currentSeasonData.metadata.episodes.find(
    (e) => e.episode_number === episode.episodeNumber && e.season_number === seasonNumber
  )

  const existingMetadataLastUpdated = new Date(
    currentEpisodeMetadata?.last_updated ?? '1970-01-01T00:00:00.000Z'
  )
  const newMetadataLastUpdated = new Date(mostRecent_episodeMetadata.last_updated)

  // Determine if an update is needed based on timestamp
  const needsUpdate =
    newMetadataLastUpdated > existingMetadataLastUpdated || !currentEpisodeMetadata

  // Verify ownership: only update if current server is the source or source is unset
  const canUpdate =
    !currentSeasonData.metadataSource ||
    isSourceMatchingServer(currentSeasonData, 'metadataSource', serverConfig)

  if (needsUpdate && canUpdate) {
    console.log(
      `TV: Updating episode metadata for "${showTitle}" Season ${seasonNumber} Episode ${episode.episodeNumber} from server ${serverConfig.id}`
    )
    return {
      ...mostRecent_episodeMetadata,
      metadataSource: serverConfig.id,
    }
  } else if (needsUpdate && !canUpdate) {
    console.log(
      `Cannot update episode metadata for "${showTitle}" Season ${seasonNumber} Episode ${episode.episodeNumber} - metadata is owned by server ${currentSeasonData.metadataSource}.`
    )
  }

  return null
}

/**
 * Processes TV season metadata updates.
 * @param {Object} client - The database client.
 * @param {Object} season - The TV season object in the database.
 * @param {Object} showData - The data for the TV show.
 * @param {Object} currentShow - The current TV show object.
 * @param {Object} showMetadata - The metadata for the TV show.
 * @param {Object} tvMetadata - The TV metadata.
 * @param {Object} serverConfig - The server configuration.
 * @param {Object} fieldAvailability - The field availability for the TV show.
 * @returns {Promise<number>} - Number of episodes updated.
 */
export async function processSeasonMetadata(
  client,
  season,
  showData,
  currentShow,
  showMetadata,
  tvMetadata,
  serverConfig,
  fieldAvailability
) {
  const seasonNumber = season.seasonNumber
  const fileServerSeasonData = showData.seasons[`Season ${seasonNumber}`]

  if (!fileServerSeasonData) {
    // console.warn(
    //   `Season ${seasonNumber} for TV show "${showData.title ?? currentShow.title}" not found on server ${serverConfig.id}. Skipping.`
    // )
    return 0
  }

  let seasonNeedsUpdate = false
  const updatedEpisodes = []

  // Create a map of episodeNumber to episodeData for quick lookup
  const episodeDataMap = {}
  Object.entries(fileServerSeasonData.episodes).forEach(([episodeFileName, episodeData]) => {
    if (episodeData.episodeNumber !== undefined && episodeData.episodeNumber !== null) {
      episodeDataMap[episodeData.episodeNumber] = { episodeFileName, episodeData }
    } else {
      console.warn(
        `Episode data missing episodeNumber for filename "${episodeFileName}" in Season ${seasonNumber} of "${showData.title ?? currentShow.title}" on server ${serverConfig.id}.`
      )
    }
  })

  // Process episodes in parallel using Promise.all
  const episodePromises = season.episodes.map(async (episode) => {
    try {
      const episodeNumber = episode.episodeNumber
      const episodeDataEntry = episodeDataMap[episodeNumber]

      if (!episodeDataEntry) {
        // console.warn(
        //   `No corresponding episode data found on server ${serverConfig.id} for Season ${seasonNumber}, Episode ${episodeNumber} of "${showData.title ?? currentShow.title}". Skipping.`
        // )
        return null
      }

      const { episodeFileName } = episodeDataEntry

      const updatedMetadata = await processEpisodeMetadata(
        episode,
        episodeFileName,
        fileServerSeasonData.episodes,
        season,
        showData.originalTitle ?? currentShow.originalTitle,
        seasonNumber,
        serverConfig,
        fieldAvailability
      )

      if (updatedMetadata) {
        seasonNeedsUpdate = true
        return updatedMetadata
      }
    } catch (error) {
      console.error(
        `Error processing episode ${seasonNumber}x${episode.episodeNumber} in "${showData.title ?? currentShow.title}" on server ${serverConfig.id}:`,
        error
      )
      return null
    }
  })

  // Wait for all episode processing to complete and filter out null results
  const processedEpisodes = (await Promise.all(episodePromises)).filter(Boolean)
  updatedEpisodes.push(...processedEpisodes)

  // Determine if season metadata needs to be updated
  const shouldUpdate = seasonNeedsUpdate || shouldUpdateSeason(showMetadata, season)
  const seasonMetadata = currentShow.seasons.find((s) => s.seasonNumber === seasonNumber).metadata

  // Deduplicate episodes based on episode_number and add updated episodes
  seasonMetadata.episodes = [
    ...new Map(
      [...(seasonMetadata.episodes || []), ...(updatedEpisodes || [])].map(episode => [episode.episode_number, episode])
    ).values()
  ]
  // sort episodes by episodeNumber
  seasonMetadata.episodes = seasonMetadata.episodes.sort((a, b) => a.episode_number - b.episode_number)
  if (shouldUpdate) {
    const updatedSeasonData = {
      ...seasonMetadata,
      metadataSource: serverConfig.id,
    }

    // Construct the field path for the season metadata
    const seasonFieldPath = `metadata`

    // Check if the current server is the highest priority for season metadata
    const isSeasonHighestPriority = isCurrentServerHighestPriorityForField(
      fieldAvailability,
      'tv',
      showData.originalTitle ?? currentShow.originalTitle,
      seasonFieldPath,
      serverConfig
    )

    if (!isSeasonHighestPriority) {
      console.log(
        `Skipping season metadata update for "${showData.title ?? currentShow.title}" Season ${seasonNumber} - higher-priority server has metadata.`
      )
      return 0
    }

    // Verify ownership before updating
    const canUpdateSeason =
      !showMetadata.metadataSource ||
      isSourceMatchingServer(showMetadata, 'metadataSource', serverConfig)

    if (canUpdateSeason) {
      console.log(
        `TV: Updating metadata for "${showData.title ?? currentShow.title}" Season ${seasonNumber} from server ${serverConfig.id}`
      )
      await client
        .db('Media')
        .collection('TV')
        .updateOne(
          { title: showData.title ?? currentShow.title },
          {
            $set: {
              'seasons.$[elem].metadata': updatedSeasonData,
            },
          },
          { arrayFilters: [{ 'elem.seasonNumber': seasonNumber }] }
        )
      return processedEpisodes.length
    } else {
      console.log(
        `Cannot update season metadata for "${showData.title ?? currentShow.title}" Season ${seasonNumber} - metadata is owned by server ${showMetadata.metadataSource}.`
      )
      return 0
    }
  }

  return 0
}

/**
 * Processes caption updates for a movie
 */
export async function processMovieCaptions(
  client,
  movie,
  fileServerData,
  serverConfig,
  fieldAvailability
) {
  if (!fileServerData?.urls) {
    throw new Error(`No data found for movie ${movie.title} on server ${serverConfig.id}`)
  }

  if (!fileServerData.urls.subtitles) return null

  const availableCaptions = processCaptionURLs(fileServerData.urls.subtitles, serverConfig)
  if (!availableCaptions) return null

  // Check if the current server is the highest priority with captions
  for (const language of Object.keys(availableCaptions)) {
    const fieldPath = `urls.subtitles.${language}.url`

    const isHighestPriority = isCurrentServerHighestPriorityForField(
      fieldAvailability,
      'movies',
      movie.title,
      fieldPath,
      serverConfig
    )

    if (!isHighestPriority) {
      // console.log(
      //   `Skipping caption update for "${movie.title}" language "${language}" - higher-priority server has captions.`
      // );
      delete availableCaptions[language] // Remove language from updates
    }
  }

  if (Object.keys(availableCaptions).length === 0) {
    // No updates to make
    return
  }

  const sameURLs = isEqual(movie.captionURLs, availableCaptions)

  const hasSameData =
    movie.captionURLs &&
    movie.captionSource &&
    isSourceMatchingServer(movie, 'captionSource', serverConfig) &&
    sameURLs

  if (!hasSameData) {
    console.log(`Movie: Updating captions for ${movie.title} from server ${serverConfig.id}`)
    const preparedUpdateData = {
      $set: {
        captionURLs: availableCaptions,
        captionSource: serverConfig.id,
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
  return false
}

/**
 * Processes episode captions by comparing captions available on the file server and the database,
 * and updates the database with any new captions found on the file server.
 *
 * @param {Object} episode - The episode object containing the current captions from the database.
 * @param {Object} fileServerEpisodeData - The episode data from the file server.
 * @param {string} episodeFileName - The filename of the episode.
 * @param {string} showTitle - The title of the TV show.
 * @param {number} seasonNumber - The season number of the episode.
 * @param {Object} serverConfig - The configuration for the current server.
 * @param {Object} fieldAvailability - The availability of fields for the current server.
 * @returns {Object|null} - An object containing the updated captions and caption source, or null if no updates are needed.
 */
async function processEpisodeCaptions(
  episode,
  fileServerEpisodeData,
  episodeFileName,
  showTitle,
  seasonNumber,
  serverConfig,
  fieldAvailability
) {
  if (!fileServerEpisodeData.subtitles) return null

  const captionsOnFileServer = processCaptionURLs(fileServerEpisodeData.subtitles, serverConfig)
  const captionsOnDB = episode.captionURLs
  const availableCaptions = Object.fromEntries(
    sortSubtitleEntries(Object.entries({ ...captionsOnDB, ...captionsOnFileServer }))
  )

  // No captions available
  if (!availableCaptions) return null

  for (const language of Object.keys(availableCaptions)) {
    const fieldPath = `seasons.Season ${seasonNumber}.episodes.${episodeFileName}.subtitles.${language}.url`

    const isHighestPriority = isCurrentServerHighestPriorityForField(
      fieldAvailability,
      'tv',
      showTitle,
      fieldPath,
      serverConfig
    )

    if (
      !isHighestPriority &&
      isSourceMatchingServer(availableCaptions[language], 'sourceServerId', serverConfig)
    ) {
      // console.log(
      //   `Skipping caption update for "${showTitle}" Season ${seasonNumber} Episode ${episode.episodeNumber} language "${language}" - higher-priority server has captions.`
      // );
      delete availableCaptions[language] // Remove language from updates
    }
  }

  if (Object.keys(availableCaptions).length === 0) {
    // No updates to make
    return null
  }

  const sameURLs = isEqual(captionsOnDB, availableCaptions)

  const hasSameData =
    captionsOnDB &&
    episode.captionSource &&
    isSourceMatchingServer(episode, 'captionSource', serverConfig) &&
    sameURLs
  if (hasSameData) return null

  // Log added subtitles for this update
  const addedSubtitles = Object.entries(availableCaptions)
    .filter(([langName]) => !captionsOnDB?.[langName])
    .map(([langName, subtitleData]) => `${langName} (${subtitleData.srcLang})`)
    .join(', ')

  if (addedSubtitles) {
    console.log(
      `TV: Updating captions for ${showTitle} - Season ${seasonNumber}, Episode ${episode.episodeNumber}`,
      `Added subtitles: ${addedSubtitles} from server ${serverConfig.id}`
    )
  }

  return {
    captionURLs: Object.fromEntries(sortSubtitleEntries(Object.entries(availableCaptions))),
    captionSource: serverConfig.id,
  }
}

/**
 * Returns an object like:
 *  {
 *    [episodeNumber]: {
 *      [languageName]: {
 *        srcLang,
 *        url,
 *        lastModified,
 *        sourceServerId,
 *        priority
 *      }
 *    }
 *  }
 * for all episodes in the given season, merged from *all* servers by priority.
 */
export function gatherSeasonCaptionsForAllServers(show, season, fileServers) {
  const aggregatedData = {} // key => episodeNumber, value => { lang => captionObj }

  // For each server
  for (const [serverId, fileServer] of Object.entries(fileServers)) {
    const serverConfig = {
      id: serverId,
      ...fileServer.config,
    }
    const fileServerShowData = fileServer.tv?.[show.title]
    if (!fileServerShowData) {
      // This server doesn't have this show
      continue
    }

    // The file server's data for the *season* we want, e.g. "Season 3"
    const seasonKey = `Season ${season.seasonNumber}`
    const fileServerSeasonData = fileServerShowData.seasons?.[seasonKey]
    if (!fileServerSeasonData) {
      // This server doesn't have this season
      continue
    }

    // For each episode in the DB season
    for (const episode of season.episodes) {
      const episodeNumber = episode.episodeNumber
      const episodeFileName = findEpisodeFileName(
        Object.keys(fileServerSeasonData.episodes || {}),
        season.seasonNumber,
        episodeNumber
      )

      if (!episodeFileName) {
        // Not found on this server
        continue
      }

      // Grab the server’s subtitles
      const fileServerEpisodeData = fileServerSeasonData.episodes[episodeFileName]
      if (!fileServerEpisodeData?.subtitles) {
        continue
      }

      const captionsOnFileServer = processCaptionURLs(fileServerEpisodeData.subtitles, serverConfig)
      if (!captionsOnFileServer) continue

      // Ensure we have an aggregated object for this episode
      if (!aggregatedData[episodeNumber]) {
        aggregatedData[episodeNumber] = {}
      }

      // Merge in the server’s data, respecting priority
      for (const [lang, subObj] of Object.entries(captionsOnFileServer)) {
        const existing = aggregatedData[episodeNumber][lang]
        if (!existing) {
          aggregatedData[episodeNumber][lang] = {
            ...subObj,
            priority: serverConfig.priority
          }
        } else {
          // If new server is higher priority (numerically lower), overwrite
          if (serverConfig.priority < existing.priority) {
            console.log(`New server is higher priority, overwriting for ${show.title} ${season.seasonNumber} ${episodeNumber} - ${lang}`)
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
 * Compare the aggregated data vs. the actual DB episodes for this season,
 * removing orphans and adding/updating as needed.
 *
 * @param {Object} client - the DB client
 * @param {Object} show - the DB show object
 * @param {Object} season - the DB season object
 * @param {Object} aggregatedData - from gatherSeasonCaptionsForAllServers (episodeNumber => language => obj)
 */
export async function finalizeSeasonCaptions(client, show, season, aggregatedData) {

  for (const episode of season.episodes) {
    const episodeNumber = episode.episodeNumber
    const aggregatedForEpisode = aggregatedData[episodeNumber] || {}

    // Build final captionURLs object
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

    // Compare
    if (!isEqual(currentCaptions, finalCaptionURLs)) {
      // Decide on captionSource
      let newCaptionSource = episode.captionSource
      if (Object.keys(finalCaptionURLs).length > 0) {
        // pick the first lang's server
        const firstLang = Object.keys(finalCaptionURLs)[0]
        newCaptionSource = finalCaptionURLs[firstLang].sourceServerId
      } else {
        // If no captions remain, can set null
        newCaptionSource = null
      }

      // Prepare update
      const updates = {
        captionURLs: finalCaptionURLs,
        captionSource: newCaptionSource
      }

      // Perform DB update
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
 * Processes season-level caption updates for a TV show.
 * @param {Object} client - The database client.
 * @param {Object} show - The TV show object from the database.
 * @param {Object} season - The season object from the database.
 * @param {Object} fileServerShowData - The file server data for the TV show.
 * @param {Object} serverConfig - The server configuration.
 * @param {Object} fieldAvailability - The field availability data.
 * @returns {Promise<number|null>} - The number of updated episodes, or null if no updates were made.
 */
export async function processSeasonCaptions(
  client,
  show,
  season,
  fileServerShowData,
  serverConfig,
  fieldAvailability
) {
  const fileServerSeasonData = fileServerShowData.seasons[`Season ${season.seasonNumber}`]
  if (!fileServerSeasonData?.episodes) {
    // throw new Error(
    //   `No data/captions found for ${show.title} - Season ${season.seasonNumber} on server ${serverConfig.id}`
    // )
    return null
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
    const updatedCaptions = await processEpisodeCaptions(
      episode,
      fileServerEpisodeData,
      episodeFileName,
      show.originalTitle,
      season.seasonNumber,
      serverConfig,
      fieldAvailability
    )

    if (updatedCaptions) {
      updates.push({
        episodeNumber: episode.episodeNumber,
        updates: {
          set: updatedCaptions
        },
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
    return updates.length
  }

  return 0
}

/**
 * Processes video information updates for an episode, integrating fieldAvailability and priority checks.
 *
 * @param {Object} episode - The episode object containing current video information.
 * @param {Object} fileServerSeasonData - The file server data for the season containing the episode.
 * @param {string} episodeFileName - The file name of the episode on the file server.
 * @param {string} showTitle - The title of the TV show.
 * @param {number} seasonNumber - The season number.
 * @param {number} episodeNumber - The episode number.
 * @param {Object} serverConfig - The server configuration.
 * @param {Object} fieldAvailability - The field availability map.
 * @returns {Promise<Object|null>} - Returns an object containing `set` and/or `unset` properties, or null if no updates are needed.
 */
export async function processEpisodeVideoInfo(
  episode,
  fileServerSeasonData,
  episodeFileName,
  showTitle,
  seasonNumber,
  episodeNumber,
  serverConfig,
  fieldAvailability
) {
  const fileData = fileServerSeasonData.episodes[episodeFileName]
  if (!fileData) {
    console.warn(
      `No additionalMetadata found for "${episodeFileName}" in server "${serverConfig.id}" data.`
    )
    return null
  }

  const dimensions = fileServerSeasonData?.dimensions[episodeFileName] || null
  const additionalMetadata = fileData.additionalMetadata || {}
  const length =
    fileServerSeasonData?.lengths[episodeFileName] || additionalMetadata?.duration || null
  const hdr = fileData.hdr || null

  const fieldsToCheck = {
    dimensions: { value: dimensions, path: '.dimensions.', fieldPath: '' },
    duration: { value: length, path: '.episodes.', fieldPath: '.additionalMetadata.duration' },
    hdr: { value: hdr, path: '.episodes.', fieldPath: '.hdr' },
    size: { value: additionalMetadata.size, path: '.episodes.', fieldPath: '.additionalMetadata.size' },
  }

  const setFields = {}
  const unsetFields = []

  for (const [field, { value: newValue, path, fieldPath }] of Object.entries(fieldsToCheck)) {
    // Construct fieldPath for fieldAvailability
    const completeFieldPath = `seasons.Season ${seasonNumber}${path}${episodeFileName}${fieldPath}`

    // Check if current server is highest priority for this field
    const isHighestPriority = isCurrentServerHighestPriorityForField(
      fieldAvailability,
      'tv',
      showTitle,
      completeFieldPath,
      serverConfig
    )

    if (!isHighestPriority) {
      // console.log(
      //   `Skipping update for field "${field}" of "${showTitle}" Season ${seasonNumber} Episode ${episodeNumber} - higher-priority server has data.`
      // );
      continue
    }

    // **1. Handling Setting/Updating the Field**

    if (newValue !== null && newValue !== undefined) {
      if (episode[field] !== newValue) {
        setFields[field] = newValue
        // Update ownership to the current server
        setFields.videoInfoSource = serverConfig.id
        console.log(
          `Setting field "${field}" for "${showTitle}" Season ${seasonNumber} Episode ${episodeNumber} from server "${serverConfig.id}".`
        )
      }
    } else {
      // **2. Handling Removal of the Field**

      // Only the owning server can unset/remove the field
      if (isSourceMatchingServer(episode, 'videoInfoSource', serverConfig) && episode[field]) {
        unsetFields.push(field)
        console.log(
          `Removing field "${field}" for "${showTitle}" Season ${seasonNumber} Episode ${episodeNumber} from server "${serverConfig.id}".`
        )
      }
    }
  }

  // **3. Prepare the updates object only if there are changes**

  if (Object.keys(setFields).length > 0 || unsetFields.length > 0) {
    const updates = {}
    if (Object.keys(setFields).length > 0) {
      updates.set = setFields
    }
    if (unsetFields.length > 0) {
      updates.unset = unsetFields
    }
    return updates
  }

  return null
}

/**
 * Processes video information updates for a season of a TV show, integrating fieldAvailability and priority checks.
 *
 * @param {Object} client - The database client.
 * @param {Object} show - The TV show object.
 * @param {Object} season - The season object.
 * @param {Object} fileServerShowData - The file server data for the TV show.
 * @param {Object} serverConfig - The server configuration.
 * @param {Object} fieldAvailability - The field availability map.
 * @returns {Promise<number>} - The number of episodes that were updated.
 */
export async function processSeasonVideoInfo(
  client,
  show,
  season,
  fileServerShowData,
  serverConfig,
  fieldAvailability
) {
  const seasonKey = `Season ${season.seasonNumber}`
  const fileServerSeasonData = fileServerShowData?.seasons[seasonKey]

  if (!fileServerSeasonData?.episodes) {
    // console.warn(`No fileNames found for "${show.title}" Season ${season.seasonNumber} on server ${serverConfig.id}. Skipping video info updates.`)
    return 0
  }

  let updatedEpisodes = 0

  await Promise.all(
    season.episodes.map(async (episode) => {
      const episodeFileName = findEpisodeFileName(
        Object.keys(fileServerSeasonData.episodes),
        season.seasonNumber,
        episode.episodeNumber
      )

      if (!episodeFileName) {
        // console.warn(
        //   `Episode file name not found for "${show.title}" Season ${season.seasonNumber} Episode ${episode.episodeNumber} on server ${serverConfig.id}. Skipping.`
        // )
        return
      }

      try {
        const updates = await processEpisodeVideoInfo(
          episode,
          fileServerSeasonData,
          episodeFileName,
          show.originalTitle,
          season.seasonNumber,
          episode.episodeNumber,
          serverConfig,
          fieldAvailability
        )

        if (updates) {
          console.log(
            `TV: Updating video info for "${show.title}" - ${seasonKey}, Episode ${episode.episodeNumber} from server ${serverConfig.id}`
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
          `Error updating video info for "${show.title}" S${season.seasonNumber}E${episode.episodeNumber} from server ${serverConfig.id}:`,
          error
        )
      }
    })
  )

  return updatedEpisodes
}

function shouldUpdateSeason(showMetadata, season) {
  return (
    new Date(showMetadata.seasons?.last_updated) >
    new Date(season.metadata.episodes?.last_updated ?? '2024-01-01T01:00:00.000000')
  )
}
