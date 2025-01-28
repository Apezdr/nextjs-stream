import { isEqual } from 'lodash'
import { updateMediaUpdates } from './admin_frontend_database'
import { fetchMetadataMultiServer } from './admin_utils'
import { getServer, isCurrentServerHigherPriority, multiServerHandler } from './config'
import chalk from 'chalk'
import { getCacheBatch } from '@src/lib/cache'

// Constants and Types
export const MediaType = {
  TV: 'tv',
  MOVIE: 'movie',
}

// File Pattern Constants
const EPISODE_FILENAME_PATTERNS = [
  /S(\d+)E(\d+)(?:\s*-\s*(.+?))?(?:\s*-\s*.+?)?\.([^.]+)$/i, // Matches 'S01E01 - Title - Extra.mp4'
  /(\d+)(?:\s*-\s*(.+?))?\.([^.]+)$/i, // Matches '01 - Title.mp4'
  /(.+?)\s*-\s*S(\d+)E(\d+)(?:\s*-\s*(.+?))?(?:\s*-\s*.+?)?\.([^.]+)$/i, // Matches '1923 - S01E01 - Title - Extra.mp4'
]

// ==========================================
// URL and Path Handling
// ==========================================

/**
 * Creates a full URL by combining a file path with a server configuration.
 * @param {string} path - The file path to be included in the URL.
 * @param {Object} serverConfig - The server configuration, which includes an ID used to retrieve a URL handler.
 * @returns {string} The full URL, constructed by the URL handler.
 */
export function createFullUrl(path, serverConfig) {
  const handler = multiServerHandler.getHandler(serverConfig.id)
  return handler.createFullURL(path, false)
}

// ==========================================
// Field Locking and Updates
// ==========================================

/**
 * Filters an update data object, excluding fields that are locked in the existing document.
 * @param {Object} existingDoc - The existing document containing the locked fields.
 * @param {Object} updateData - The update data object to be filtered.
 * @returns {Object} A new object containing only the unlocked fields from the update data.
 */
export function filterLockedFields(existingDoc, updateData) {
  const lockedFields = existingDoc.lockedFields || {}
  const result = {}

  function isFieldLocked(fieldPath) {
    const parts = fieldPath.split('.')
    let current = lockedFields

    for (const part of parts) {
      if (current[part] === true) {
        return true
      } else if (typeof current[part] === 'object' && current[part] !== null) {
        current = current[part]
      } else {
        return false
      }
    }
    return false
  }

  function process(obj, path = '', existingObj = existingDoc) {
    for (const key in obj) {
      const value = obj[key]
      const fullPath = path ? `${path}.${key}` : key

      if (isFieldLocked(fullPath)) continue

      const existingValue = existingObj ? existingObj[key] : undefined

      if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        (existingValue === null || typeof existingValue !== 'object')
      ) {
        result[fullPath] = value
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        process(value, fullPath, existingValue)
      } else {
        result[fullPath] = value
      }
    }
  }

  process(updateData)
  return result
}

// ==========================================
// Episode Handling
// ==========================================

/**
 * Finds the file name that matches the given season and episode number.
 *
 * @param {string[]} fileNames - An array of file names to search through.
 * @param {number} seasonNumber - The season number to search for.
 * @param {number} episodeNumber - The episode number to search for.
 * @returns {string|null} The file name that matches the given season and episode number, or `null` if no match is found.
 */
export function findEpisodeFileName(fileNames, seasonNumber, episodeNumber) {
  return fileNames.find((fileName) => {
    const episodeNumberRegex = new RegExp(
      `(S?${seasonNumber.toString().padStart(2, '0')}E${episodeNumber.toString().padStart(2, '0')})|^${episodeNumber.toString().padStart(2, '0')}\\s?-`,
      'i'
    )
    return episodeNumberRegex.test(fileName)
  })
}

/**
 * Matches the given file name against a set of predefined patterns to extract episode details.
 *
 * @param {string} filename - The file name to match against the patterns.
 * @returns {RegExpMatchArray|null} The matched pattern, or `null` if no match is found.
 */
export function matchEpisodeFileName(filename) {
  for (const pattern of EPISODE_FILENAME_PATTERNS) {
    const match = filename.match(pattern)
    if (match) return match
  }
  return null
}

/**
 * Extracts episode details from a file name match.
 *
 * This function takes a regular expression match object and parses it to extract the season number, episode number, episode title, and file extension. It supports three different patterns for the file name:
 *
 * 1. `SxxExx`: The file name follows the pattern "Season XX, Episode XX" with an optional episode title and file extension.
 * 2. `xx - Title`: The file name follows the pattern "Episode XX - Title" with a file extension.
 * 3. `Title - SxxExx - Title - Extra`: The file name follows the pattern "Title - Season XX, Episode XX - Title - Extra" with a file extension.
 *
 * @param {RegExpMatchArray|null} match - The regular expression match object.
 * @returns {Object|null} An object containing the extracted episode details, or `null` if no match is found.
 */
export function extractEpisodeDetails(match) {
  if (!match) return null

  // Pattern 1: SxxExx
  if (match.length === 5 && match[1] && match[2]) {
    return {
      seasonNumber: parseInt(match[1]),
      episodeNumber: parseInt(match[2]),
      title: cleanEpisodeTitle(match[3]),
      extension: match[4],
    }
  }

  // Pattern 2: xx - Title
  if (match.length === 4 && match[1] && match[2]) {
    return {
      seasonNumber: null,
      episodeNumber: parseInt(match[1]),
      title: cleanEpisodeTitle(match[2]),
      extension: match[3],
    }
  }

  // Pattern 3: Title - SxxExx - Title - Extra
  if (match.length === 6 && match[2] && match[3]) {
    return {
      seasonNumber: parseInt(match[2]),
      episodeNumber: parseInt(match[3]),
      title: cleanEpisodeTitle(match[4]),
      extension: match[5],
    }
  }

  return null
}

/**
 * Cleans the episode title by removing common video format tags.
 *
 * This helper function is used by `extractEpisodeDetails` to remove common video format tags (e.g. "WEBRip", "WEBDL", "HDTV", "Bluray", "1080p") from the episode title.
 *
 * @param {string} title - The episode title to be cleaned.
 * @returns {string} The cleaned episode title, or an empty string if the input title is falsy.
 */
function cleanEpisodeTitle(title) {
  return title ? title.replace(/(WEBRip|WEBDL|HDTV|Bluray|\d{3,4}p).*$/i, '').trim() : ''
}

// ==========================================
// Database Operations
// ==========================================

/**
 * Updates an episode in the database.
 *
 * This function updates the specified episode in the TV collection of the Media database. It takes the client connection, the show title, the season number, the episode number, and an object of updates to apply to the episode.
 *
 * The `updates` object can have two optional properties:
 * - `set`: An object containing fields to set/update.
 * - `unset`: An array of field names to unset/remove.
 *
 * @param {Object} client - The MongoDB client connection.
 * @param {string} showTitle - The title of the TV show.
 * @param {number} seasonNumber - The season number of the episode.
 * @param {number} episodeNumber - The episode number.
 * @param {Object} updates - An object containing `set` and/or `unset` properties.
 * @returns {Promise<Object>} - The result of the updateOne operation.
 */
export async function updateEpisodeInDatabase(
  client,
  showTitle,
  seasonNumber,
  episodeNumber,
  updates
) {
  const updateOperation = {}

  // Handle $set operations
  if (updates.set && Object.keys(updates.set).length > 0) {
    updateOperation.$set = {}
    for (const [key, value] of Object.entries(updates.set)) {
      updateOperation.$set[`seasons.$[season].episodes.$[episode].${key}`] = value
    }
  }

  // Handle $unset operations
  if (updates.unset && Array.isArray(updates.unset) && updates.unset.length > 0) {
    updateOperation.$unset = {}
    for (const key of updates.unset) {
      updateOperation.$unset[`seasons.$[season].episodes.$[episode].${key}`] = ''
    }
  }

  // If no operations are specified, exit early
  if (Object.keys(updateOperation).length === 0) {
    console.warn('No valid update operations provided.')
    return
  }

  console.log(`Updating show: ${showTitle}, Season: ${seasonNumber}, Episode: ${episodeNumber}`)
  console.log('Update Operation:', JSON.stringify(updateOperation, null, 2))

  try {
    const result = await client
      .db('Media')
      .collection('TV')
      .updateOne({ title: showTitle }, updateOperation, {
        arrayFilters: [
          { 'season.seasonNumber': seasonNumber },
          { 'episode.episodeNumber': episodeNumber },
        ],
      })

    console.log('Update Result:', result)

    if (result.matchedCount === 0) {
      console.warn(
        `No matching document found for show "${showTitle}" Season ${seasonNumber} Episode ${episodeNumber}.`
      )
    } else if (result.modifiedCount === 0) {
      console.warn(
        `No changes were made to show "${showTitle}" Season ${seasonNumber} Episode ${episodeNumber}.`
      )
    } else {
      console.log(
        `Successfully updated show "${showTitle}" Season ${seasonNumber} Episode ${episodeNumber}.`
      )
    }

    return result
  } catch (error) {
    console.error(
      `Error updating show "${showTitle}" Season ${seasonNumber} Episode ${episodeNumber}:`,
      error
    )
    throw error // Re-throw the error after logging
  }
}

/**
 * Updates media data in the database.
 *
 * This function updates the specified media item (TV show or movie) in the appropriate collection of the Media database. It takes the MongoDB client connection, the media type, the title of the media, and an object of updates to apply.
 *
 * @param {Object} client - The MongoDB client connection.
 * @param {string} mediaType - The type of media, either 'TV' or 'Movies'.
 * @param {string} title - The title of the media item.
 * @param {Object} updates - An object containing the updates to apply to the media item, including MongoDB update operators like $set and $unset.
 * @returns {Promise<void>} - A Promise that resolves when the update operation is complete.
 */
export async function updateMediaInDatabase(client, mediaType, title, updates) {
  const collectionName = mediaType === MediaType.TV ? 'TV' : 'Movies'

  // Validate that 'updates' contains valid MongoDB update operators
  const allowedOperators = [
    '$set',
    '$unset',
    '$inc',
    '$push',
    '$pull',
    '$addToSet',
    '$rename',
    '$currentDate',
  ]
  const updateKeys = Object.keys(updates)

  const hasValidOperator = updateKeys.some((key) => allowedOperators.includes(key))
  if (!hasValidOperator) {
    throw new Error(`Invalid update operators provided: ${updateKeys.join(', ')}`)
  }

  await client
    .db('Media')
    .collection(collectionName)
    .updateOne({ title }, updates, { upsert: true })

  await updateMediaUpdates(title, mediaType)
}

// ==========================================
// Media Processing
// ==========================================

/**
 * Processes the caption URLs from the subtitles data.
 *
 * This function takes the subtitles data and the server configuration, and returns an object of subtitle URLs with their corresponding language names, source languages, and last modified timestamps.
 *
 * @param {Object} subtitlesData - The subtitles data, which is an object with language names as keys and subtitle data as values.
 * @param {Object} serverConfig - The server configuration, which is used to create the full URL for the subtitle files.
 * @returns {Object} - An object of subtitle URLs, with language names as keys and an object containing the source language, URL, and last modified timestamp as values.
 */
export function processCaptionURLs(subtitlesData, serverConfig) {
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
 * Sorts the subtitle entries, prioritizing English subtitles.
 *
 * This helper function is used by the `processCaptionURLs` function to sort the subtitle entries by language, with English subtitles being prioritized.
 *
 * @param {[string, Object][]} entries - An array of key-value pairs representing the subtitle entries.
 * @returns {[string, Object][]} - The sorted array of subtitle entries.
 */
function sortSubtitleEntries(entries) {
  return entries.sort(([langNameA], [langNameB]) => {
    if (langNameA.toLowerCase().includes('english')) return -1
    if (langNameB.toLowerCase().includes('english')) return 1
    return 0
  })
}

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

function extractSeasonInfo(seasonInfo, showTitle, fileServer, serverConfig) {
  try {
    // This handles the full season data
    if (!seasonInfo) {
      throw new Error('Season info is undefined')
    }

    const seasonIdentifier = seasonInfo.season || seasonInfo
    const season_ = fileServer?.tv[showTitle].seasons[seasonIdentifier]
    if (typeof seasonInfo === 'string') {
      return {
        number: season_.seasonNumber,
        seasonIdentifier: seasonIdentifier,
        season_poster: season_.season_poster,
        posterSource: serverConfig.id,
        seasonPosterBlurhash: season_.seasonPosterBlurhash,
        seasonPosterBlurhashSource: serverConfig.id,
        episodes: Object.keys(season_.episodes).map(function (seasonAndEpisode) {
          const episode = season_.episodes[seasonAndEpisode]
          const length = season_.lengths[seasonAndEpisode]
          const dimensions = season_.dimensions[seasonAndEpisode]
          let returnData = {
            ...episode,
            key: seasonAndEpisode,
            _id: episode._id,
            length: length,
            dimensions: dimensions,
            mediaLastModified: new Date(episode.mediaLastModified),
          }
          if (episode.videoURL) {
            returnData.videoSource = serverConfig.id
          }
          if (episode.thumbnail) {
            returnData.thumbnailSource = serverConfig.id
          }
          if (episode.thumbnailBlurhash) {
            returnData.thumbnailBlurhashSource = serverConfig.id
          }
          if (!episode.hdr) delete returnData.hdr
          return returnData
        }),
      }
    } else {
      // This is used for populating missing episodes from a season
      // ex. some episodes are missing from a season
      if (!seasonIdentifier) {
        throw new Error('Season number is undefined')
      }

      return {
        number: season_.seasonNumber,
        seasonIdentifier: seasonIdentifier,
        season_poster: season_.season_poster,
        posterSource: serverConfig.id,
        seasonPosterBlurhash: season_.seasonPosterBlurhash,
        seasonPosterBlurhashSource: serverConfig.id,
        episodes: seasonInfo.missingEpisodes.map(function (episode) {
          let returnData = {
            ...episode,
            _id: episode._id,
            mediaLastModified: new Date(episode.mediaLastModified),
            length: episode.length,
            dimensions: episode.dimensions,
          }
          if (episode.videoURL) {
            returnData.videoSource = serverConfig.id
          }
          if (episode.thumbnail) {
            returnData.thumbnail = episode.thumbnail
            returnData.thumbnailSource = serverConfig.id
          }
          if (episode.thumbnailBlurhash) {
            returnData.thumbnailBlurhash = episode.thumbnailBlurhash
            returnData.thumbnailBlurhashSource = serverConfig.id
          }
          if (episode.metadata) {
            returnData.metadata = episode.metadata
          }
          if (!episode.hdr) delete returnData.hdr
          return returnData
        }),
      }
    }
  } catch (error) {
    // handle error
    console.error('Error Processing', showTitle, seasonInfo, error)
    throw error
  }
}

/**
 * Process movie data from the file server and return an updated data object for the database.
 * @param {string} movieTitle - The title of the movie.
 * @param {Object} movieData - The movie data from the file server.
 * @param {Object} serverConfig - The server configuration.
 * @returns {Object|null} - The updated movie data, or null if the movie cannot be processed.
 */
export async function processMovieData(movieTitle, movieData, serverConfig) {
  const mp4File = movieData.fileNames.find((name) => name.endsWith('.mp4'))
  if (!mp4File) {
    console.log(`Movie: No MP4 file found for ${movieTitle}. Skipping.`)
    return null
  }

  const movieMetadata = await fetchMetadataMultiServer(
    serverConfig.id,
    movieData.urls?.metadata,
    'file',
    'movie',
    movieTitle
  )
  if (!movieMetadata) {
    console.log(`Movie: No metadata found for ${movieTitle}. Skipping.`)
    return null
  }

  if (typeof movieMetadata.release_date !== 'object') {
    movieMetadata.release_date = new Date(movieMetadata.release_date)
  }

  const urlFields = [
    { name: 'poster', dbField: 'posterURL' },
    { name: 'posterBlurhash' },
    { name: 'logo' },
    { name: 'chapters', dbField: 'chapterURL' },
    { name: 'backdrop' },
    { name: 'backdropBlurhash' },
  ]

  const updateData = {
    title: movieTitle,
    videoURL: createFullUrl(movieData.urls.mp4, serverConfig),
    mediaLastModified: new Date(movieData.urls.mediaLastModified),
    length: movieData.length[mp4File],
    dimensions: movieData.dimensions[mp4File],
    metadata: movieMetadata,
    metadataSource: serverConfig.id,
  }

  for (const field of urlFields) {
    const fileServerValue = movieData.urls[field.name]
    if (fileServerValue) {
      updateData[field.dbField || field.name] = createFullUrl(fileServerValue, serverConfig)
      updateData[field.name + 'Source'] = serverConfig.id
    }
  }

  const captionURLs = processCaptionURLs(movieData.urls?.subtitles, serverConfig)
  if (captionURLs) {
    updateData.captionURLs = captionURLs
  }

  return updateData
}

export function processShowData(showData, showMetadata, currentShow, serverConfig) {
  return {
    metadata: showMetadata,
    seasons: currentShow.seasons,
    posterURL: createFullUrl(showData.poster, serverConfig),
    posterSource: serverConfig.id,
    posterBlurhash: createFullUrl(showData.posterBlurhash, serverConfig),
    posterBlurhashSource: serverConfig.id,
    backdrop: createFullUrl(showData.backdrop, serverConfig),
    backdropSource: serverConfig.id,
    backdropBlurhash: createFullUrl(showData.backdropBlurhash, serverConfig),
    backdropBlurhashSource: serverConfig.id,
    ...(showData.logo && { logo: createFullUrl(showData.logo, serverConfig) }),
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
 * Gathers metadata for a single movie across ALL servers in parallel (batch),
 * picking the "best" metadata among all valid responses.
 *
 * "Best" is determined by:
 *   1. Lowest server priority
 *   2. Largest last_updated if priorities are equal
 *
 * @param {Object} movie - The DB movie object (e.g., { title, metadata, metadataSource, ... })
 * @param {Object} fileServers - All server data, keyed by serverId
 * @returns {Object|null} - The best metadata object or null if none found
 */
export async function gatherMovieMetadataForAllServers(movie, fileServers) {
  // 1) Build a list of servers that actually have a metadata URL for this movie
  const movieMetadataEntries = Object.entries(fileServers)
    .map(([serverId, fileServer]) => {
      const fileServerMovieData = fileServer.movies?.[movie.title];
      if (!fileServerMovieData) return null;

      const metadataURL = fileServerMovieData.urls?.metadata;
      if (!metadataURL) return null;

      // Prepare a "batch entry" similar to the TV logic
      const serverConfig = { id: serverId, ...fileServer.config };
      const cacheKey = `${serverConfig.id}:file:${metadataURL}`;

      return { serverId, serverConfig, metadataURL, cacheKey };
    })
    .filter(Boolean);

  // If no servers have metadata for this movie, return null
  if (movieMetadataEntries.length === 0) {
    return null;
  }

  // 2) Retrieve any existing cache entries in batch
  const movieCacheKeys = movieMetadataEntries.map((entry) => entry.cacheKey);
  const cachedMovieEntries = await getCacheBatch(movieCacheKeys);

  // 3) Prepare concurrency-limited fetch promises
  const fetchPromises = movieMetadataEntries.map((entry) => {
    const { serverId, serverConfig, metadataURL, cacheKey } = entry;
    const cachedEntry = cachedMovieEntries[cacheKey];

    // Build conditional headers
    const headers = {};
    if (cachedEntry) {
      if (cachedEntry.etag) {
        headers['If-None-Match'] = cachedEntry.etag;
      }
      if (cachedEntry.lastModified) {
        headers['If-Modified-Since'] = cachedEntry.lastModified;
      }
    }

    // Return an object that includes everything we need to do the actual fetch
    return {
      serverId,
      serverConfig,
      metadataURL,
      headers,
      cacheKey,
    };
  });

  // Execute all fetch operations concurrently (with optional p-limit)
  const results = await Promise.all(
    fetchPromises.map((entry) =>
      fetchMetadataMultiServer(
        entry.serverId,
        entry.metadataURL,
        'file',
        'movie',
        movie.title,
        entry.headers,
        entry.cacheKey
      )
    )
  );

  // 4) Pair up each result with its server priority so we can pick the "best"
  const validMetadataArray = results
    .map((metadata, index) => {
      if (!metadata) return null;
      const { priority } = fetchPromises[index].serverConfig;
      return {
        metadata,
        priority,
      };
    })
    .filter(Boolean);

  // 5) Determine the best metadata
  // (Same logic as used in TV code: pick the lowest priority, then newest last_updated.)
  const bestMetadata = determineBestMetadata(validMetadataArray);

  if (bestMetadata.release_date && typeof bestMetadata.release_date === 'string') {
    bestMetadata.release_date = new Date(bestMetadata.release_date)
  }

  return bestMetadata;
}

/**
 * Compare the aggregated "bestMetadata" vs. the DB's existing movie metadata, 
 * and update if needed.
 *
 * @param {Object} client - DB client
 * @param {Object} movie - DB movie object (with .metadata, .metadataSource, etc.)
 * @param {Object} bestMetadata - from gatherMovieMetadataForAllServers
 * @returns {Promise<void>}
 */
export async function finalizeMovieMetadata(client, movie, bestMetadata) {
  if (!bestMetadata) {
    // No server had metadata => optionally remove DB metadata or do nothing
    return
  }

  // Compare last_updated
  const existingMetadataLastUpdated = new Date(movie.metadata?.last_updated || '1970-01-01')
  const newMetadataLastUpdated = new Date(bestMetadata.last_updated || '1970-01-01')

  if (newMetadataLastUpdated <= existingMetadataLastUpdated) {
    // The DB is same or newer => do nothing
    return
  }

  // Also check ownership if you have the concept of locked metadata. 
  // If the DB says "metadataSource" is a different, higher-priority server, 
  // you might skip. Or just do filterLockedFields...
  const updateData = {
    metadata: bestMetadata,
    metadataSource: bestMetadata.metadataSource // If you want, you can track which server provided bestMetadata
  }

  // Remove metadataSource from the updateData
  delete updateData.metadata?.metadataSource

  const filteredUpdateData = filterLockedFields(movie, updateData)
  if (Object.keys(filteredUpdateData).length === 0) {
    console.log(`All metadata fields locked for movie "${movie.title}". Skipping update.`)
    return
  }

  console.log(`Movie: Updating metadata for "${movie.title}"...`)
  const preparedUpdateData = { $set: filteredUpdateData }
  await updateMediaInDatabase(client, MediaType.MOVIE, movie.title, preparedUpdateData)
}

/**
 * Processes movie metadata updates
 * @param {Object} client - Database client
 * @param {Object} currentMovieData - Current movie data in database
 * @param {Object} fileServerMovieData - Movie data from file server
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability
 */
export async function processMovieMetadata(
  client,
  currentMovieData,
  fileServerMovieData,
  serverConfig,
  fieldAvailability
) {
  if (!fileServerMovieData) {
    // console.log(
    //   `Movie: No data found for ${currentMovieData.title} on server ${serverConfig.id}. Skipping.`
    // )
    return
  }

  // Construct the field path for the movie metadata
  const fieldPath = 'urls.metadata'

  // Check if the current server is the highest priority with metadata
  const isHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'movies',
    currentMovieData.title,
    fieldPath,
    serverConfig
  )

  if (!isHighestPriority) {
    // console.log(
    //   `Skipping metadata update for "${currentMovieData.title}" - higher-priority server has metadata.`
    // )
    return
  }

  const movieMetadata = await fetchMetadataMultiServer(
    serverConfig.id,
    fileServerMovieData.urls?.metadata,
    'file',
    'movie',
    currentMovieData.title
  )

  if (!movieMetadata) {
    throw new Error(
      `No metadata found for movie "${currentMovieData.title}" on server ${serverConfig.id}`
    )
  }

  // Ensure release_date is a Date object
  if (typeof movieMetadata.release_date !== 'object') {
    movieMetadata.release_date = new Date(movieMetadata.release_date)
  }

  const existingMetadataLastUpdated = new Date(
    currentMovieData.metadata?.last_updated ?? '1970-01-01T00:00:00.000Z'
  )
  const newMetadataLastUpdated = new Date(movieMetadata.last_updated)

  // Check if new metadata is more recent
  if (newMetadataLastUpdated > existingMetadataLastUpdated) {
    // Verify that the current server is the source of existing metadata or it's unset
    const canUpdate =
      !currentMovieData.metadataSource ||
      isSourceMatchingServer(currentMovieData, 'metadataSource', serverConfig)

    if (canUpdate) {
      const updateData = {
        metadata: movieMetadata,
        metadataSource: serverConfig.id,
      }
      const filteredUpdateData = filterLockedFields(currentMovieData, updateData)

      // Remove empty objects
      if (filteredUpdateData.metadata && Object.keys(filteredUpdateData.metadata).length === 0) {
        delete filteredUpdateData.metadata
      }

      if (Object.keys(filteredUpdateData).length > 0) {
        console.log(
          `Movie: Updating metadata for "${currentMovieData.title}" from server ${serverConfig.id}`
        )
        const preparedUpdateData = {
          $set: filteredUpdateData,
        }
        await updateMediaInDatabase(
          client,
          MediaType.MOVIE,
          currentMovieData.title,
          preparedUpdateData,
          serverConfig.id
        )
      } else {
        console.log(
          `All metadata fields are locked for movie "${currentMovieData.title}" on server ${serverConfig.id}. Skipping update.`
        )
      }
    } /*else {
      console.log(
        `Cannot update metadata for "${currentMovieData.title}" - metadata is owned by server ${currentMovieData.metadataSource}.`
      )
    }*/
  }
}

/**
 * Helper function to determine the best metadata based on priority and last_updated
 */
function determineBestMetadata(metadataArray) {
  return metadataArray.reduce((best, current) => {
    if (!best) return current;
    if (current.priority < best.priority) return current;
    if (
      current.priority === best.priority &&
      new Date(current.metadata.last_updated) > new Date(best.metadata.last_updated)
    ) {
      return current;
    }
    return best;
  }, null)?.metadata || null;
}

/**
 * Gather TV metadata for a single show from ALL servers concurrently.
 *
 * @param {Object} show - The DB show object.
 * @param {Object} fileServers - The raw data from all servers, keyed by serverId.
 * @returns {Object} aggregatedData with shape:
 *   {
 *     showMetadata: {...},
 *     seasons: {
 *       [seasonNumber]: {
 *         seasonMetadata: {...},
 *         episodes: {
 *           [episodeNumber]: {...}
 *         }
 *       }
 *     }
 *   }
 */
export async function gatherTvMetadataForAllServers(show, fileServers) {
  const aggregatedData = {
    showMetadata: null,
    seasons: {},
  };

  // 1) Gather Show-Level Metadata Concurrently
  const showMetadataEntries = Object.entries(fileServers).map(([serverId, fileServer]) => {
    if (!fileServer.tv?.[show.title]) return null;
    const serverConfig = { id: serverId, ...fileServer.config };
    const metadataURL = fileServer.tv[show.title]?.metadata;
    if (!metadataURL) return null;

    const cacheKey = `${serverConfig.id}:file:${metadataURL}`;
    return { serverId, serverConfig, metadataURL, cacheKey };
  }).filter(Boolean);

  const showCacheKeys = showMetadataEntries.map(entry => entry.cacheKey);
  const cachedShowEntries = await getCacheBatch(showCacheKeys);

  const fetchShowPromises = showMetadataEntries.map((entry) => {
    const { serverId, serverConfig, metadataURL, cacheKey } = entry;
    const cachedEntry = cachedShowEntries[cacheKey];

    const headers = {};
    if (cachedEntry) {
      if (cachedEntry.etag) {
        headers['If-None-Match'] = cachedEntry.etag;
      }
      if (cachedEntry.lastModified) {
        headers['If-Modified-Since'] = cachedEntry.lastModified;
      }
    }

    return {
      serverId,
      serverConfig,
      metadataURL,
      headers,
      cacheKey,
    };
  });

  // Execute all fetch operations concurrently
  const fetchShowData = await Promise.all(
    fetchShowPromises.map(entry => fetchMetadataMultiServer(
        entry.serverId,
        entry.metadataURL,
        'file',
        'tv',
        show.title,
        entry.headers,
        entry.cacheKey
      ))
  );

  // Filter out null responses and determine the best metadata
  const validShowMetadata = fetchShowData
    .map((data, index) => {
      if (!data) return null;
      return { metadata: data, priority: showMetadataEntries[index].serverConfig.priority };
    })
    .filter(Boolean);

  const bestShowMetadata = determineBestMetadata(validShowMetadata);
  aggregatedData.showMetadata = bestShowMetadata;

  // 2) Gather Season and Episode-Level Metadata Concurrently
  const seasonPromises = show.seasons.map(async (season) => {
    const { seasonNumber } = season;

    // Gather Season Metadata Concurrently
    const seasonMetadataEntries = Object.entries(fileServers).map(([serverId, fileServer]) => {
      const serverConfig = { id: serverId, ...fileServer.config };
      const fileServerShowData = fileServer.tv?.[show.title];
      if (!fileServerShowData) return null;

      const seasonKey = `Season ${seasonNumber}`;
      const seasonData = fileServerShowData.seasons?.[seasonKey];
      if (!seasonData?.metadata) return null;

      const metadataURL = seasonData.metadata;
      const cacheKey = `${serverConfig.id}:file:${metadataURL}`;
      return { serverId, serverConfig, metadataURL, cacheKey };
    }).filter(Boolean);

    if (seasonMetadataEntries.length === 0) return;

    const seasonCacheKeys = seasonMetadataEntries.map(entry => entry.cacheKey);
    const cachedSeasonEntries = await getCacheBatch(seasonCacheKeys);

    const fetchSeasonPromises = seasonMetadataEntries.map((entry) => {
      const { serverId, serverConfig, metadataURL, cacheKey } = entry;
      const cachedEntry = cachedSeasonEntries[cacheKey];

      const headers = {};
      if (cachedEntry) {
        if (cachedEntry.etag) {
          headers['If-None-Match'] = cachedEntry.etag;
        }
        if (cachedEntry.lastModified) {
          headers['If-Modified-Since'] = cachedEntry.lastModified;
        }
      }

      return {
        serverId,
        serverConfig,
        metadataURL,
        headers,
        cacheKey,
      };
    });

    const fetchSeasonData = await Promise.all(
      fetchSeasonPromises.map(entry => 
        limit(() => fetchMetadataMultiServer(
          entry.serverId,
          entry.metadataURL,
          'file',
          'tv',
          show.title,
          entry.headers,
          entry.cacheKey
        ))
      )
    );

    const validSeasonMetadata = fetchSeasonData
      .map((data, index) => {
        if (!data) return null;
        return { metadata: data, priority: seasonMetadataEntries[index].serverConfig.priority };
      })
      .filter(Boolean);

    const bestSeasonMetadata = determineBestMetadata(validSeasonMetadata);

    // Gather Episode Metadata Concurrently
    const episodePromises = season.episodes.map(async (episode) => {
      const { episodeNumber } = episode;

      const episodeMetadataEntries = Object.entries(fileServers).map(([serverId, fileServer]) => {
        const serverConfig = { id: serverId, ...fileServer.config };
        const fileServerShowData = fileServer.tv?.[show.title];
        if (!fileServerShowData) return null;

        const seasonKey = `Season ${seasonNumber}`;
        const fsSeasonData = fileServerShowData.seasons?.[seasonKey];
        if (!fsSeasonData?.episodes) return null;

        const episodeFileName = findEpisodeFileName(
          Object.keys(fsSeasonData.episodes),
          seasonNumber,
          episodeNumber
        );
        if (!episodeFileName) return null;

        const episodeData = fsSeasonData.episodes[episodeFileName];
        if (!episodeData?.metadata) return null;

        const metadataURL = episodeData.metadata;
        const cacheKey = `${serverConfig.id}:file:${metadataURL}`;
        return { serverId, serverConfig, metadataURL, cacheKey };
      }).filter(Boolean);

      if (episodeMetadataEntries.length === 0) return;

      const episodeCacheKeys = episodeMetadataEntries.map(entry => entry.cacheKey);
      const cachedEpisodeEntries = await getCacheBatch(episodeCacheKeys);

      const fetchEpisodePromises = episodeMetadataEntries.map((entry) => {
        const { serverId, serverConfig, metadataURL, cacheKey } = entry;
        const cachedEntry = cachedEpisodeEntries[cacheKey];

        const headers = {};
        if (cachedEntry) {
          if (cachedEntry.etag) {
            headers['If-None-Match'] = cachedEntry.etag;
          }
          if (cachedEntry.lastModified) {
            headers['If-Modified-Since'] = cachedEntry.lastModified;
          }
        }

        return {
          serverId,
          serverConfig,
          metadataURL,
          headers,
          cacheKey,
        };
      });

      const fetchEpisodeData = await Promise.all(
        fetchEpisodePromises.map(entry => 
          limit(() => fetchMetadataMultiServer(
            entry.serverId,
            entry.metadataURL,
            'file',
            'tv',
            show.title,
            entry.headers,
            entry.cacheKey
          ))
        )
      );

      const validEpisodeMetadata = fetchEpisodeData
        .map((data, index) => {
          if (!data) return null;
          return { metadata: data, priority: episodeMetadataEntries[index].serverConfig.priority };
        })
        .filter(Boolean);

      const bestEpisodeMetadata = determineBestMetadata(validEpisodeMetadata);

      if (bestSeasonMetadata || bestEpisodeMetadata) {
        aggregatedData.seasons[seasonNumber] = aggregatedData.seasons[seasonNumber] || {
          seasonMetadata: null,
          episodes: {},
        };

        if (bestSeasonMetadata) {
          aggregatedData.seasons[seasonNumber].seasonMetadata = bestSeasonMetadata;
        }

        if (bestEpisodeMetadata) {
          aggregatedData.seasons[seasonNumber].episodes[episodeNumber] = bestEpisodeMetadata;
        }
      }
    });

    await Promise.all(episodePromises);
  });

  await Promise.all(seasonPromises);

  return aggregatedData;
}

/**
 * Selects the best metadata based on server priority and last_updated timestamp.
 *
 * @param {Object|null} currentBestMetadata - The current best metadata.
 * @param {string|null} currentBestSource - The server ID of the current best metadata source.
 * @param {Object} newMetadata - The newly fetched metadata.
 * @param {Object} newServerConfig - The server configuration of the new metadata source.
 * @returns {Object} - Updated best metadata and its source.
 */
function selectBestMetadata(currentBestMetadata, currentBestSource, newMetadata, newServerConfig) {
  if (!currentBestMetadata) {
    return {
      metadata: { ...newMetadata, metadataSource: newServerConfig.id },
      metadataSource: newServerConfig.id,
    };
  }

  const existingPriority = serverManager.getServerPriority(currentBestSource);
  const newPriority = serverManager.getServerPriority(newServerConfig.id);

  if (newPriority < existingPriority) {
    // New server has higher priority
    return {
      metadata: { ...newMetadata, metadataSource: newServerConfig.id },
      metadataSource: newServerConfig.id,
    };
  } else if (newPriority === existingPriority) {
    // Same priority, choose the most recently updated
    const existingLastUpdated = new Date(currentBestMetadata.last_updated || '1970-01-01');
    const newLastUpdated = new Date(newMetadata.last_updated || '1970-01-01');

    if (newLastUpdated > existingLastUpdated) {
      return {
        metadata: { ...newMetadata, metadataSource: newServerConfig.id },
        metadataSource: newServerConfig.id,
      };
    }
  }

  // Existing metadata is better
  return {
    metadata: currentBestMetadata,
    metadataSource: currentBestSource,
  };
}

/**
 * Compare aggregated TV metadata vs. DB and update if needed.
 *
 * @param {Object} client - The DB client.
 * @param {Object} show - The DB show object (with .metadata, .seasons, etc.).
 * @param {Object} aggregatedData - Output of gatherTvMetadataForAllServers().
 */
export async function finalizeTvMetadata(client, show, aggregatedData) {
  if (!aggregatedData?.showMetadata) {
    // No metadata found from any server. Optionally you can do nothing or clear existing.
    return
  }

  // --- 1) Finalize SHOW-LEVEL METADATA ---
  const existingMetadataLastUpdated = new Date(show.metadata?.last_updated || '1970-01-01')
  const newMetadataLastUpdated = new Date(aggregatedData.showMetadata.last_updated || '1970-01-01')
  
  const canUpdateShowLevel = isCurrentServerHigherPriority(
    show.metadataSource, 
    { id: aggregatedData.showMetadata.metadataSource || show.metadataSource }
  )

  if (newMetadataLastUpdated > existingMetadataLastUpdated && canUpdateShowLevel) {
    // Also apply locked-field filtering if you use it
    const updateData = {
      metadata: aggregatedData.showMetadata,
      metadataSource: aggregatedData.showMetadata.metadataSource
    }
    // Remove metadataSource from nested structure
    delete updateData.metadata.metadataSource

    const filteredUpdateData = filterLockedFields(show, updateData)
    if (Object.keys(filteredUpdateData).length > 0) {
      console.log(`Updating show-level metadata for "${show.title}"...`)
      await updateMediaInDatabase(client, MediaType.TV, show.title, { $set: filteredUpdateData })
    }
  }

  // --- 2) Finalize SEASON-LEVEL METADATA ---
  for (const [seasonNumber, seasonAggData] of Object.entries(aggregatedData.seasons)) {
    const existingSeason = show.seasons.find((s) => s.seasonNumber === Number(seasonNumber))
    if (!existingSeason) {
      // This theoretically shouldn't happen if `show.seasons` is accurate, 
      // but handle gracefully
      continue
    }

    if (seasonAggData.seasonMetadata) {
      const existingSeasonLastUpdated = new Date(
        existingSeason.metadata?.last_updated || '1970-01-01'
      )
      const newSeasonLastUpdated = new Date(
        seasonAggData.seasonMetadata.last_updated || '1970-01-01'
      )

      const canUpdateSeason = isCurrentServerHigherPriority(
        existingSeason.metadataSource,
        { id: seasonAggData.seasonMetadata.metadataSource }
      ) || !existingSeason.metadataSource

      if (newSeasonLastUpdated > existingSeasonLastUpdated && canUpdateSeason) {
        const updateData = {
          [`seasons.$[elem].metadata`]: seasonAggData.seasonMetadata,
          [`seasons.$[elem].metadataSource`]: seasonAggData.seasonMetadata.metadataSource
        }
        delete updateData[`seasons.$[elem].metadata`].metadataSource

        // Filter locked fields at the show level if needed
        // Or if you keep locked fields at the season level
        const filtered = filterLockedFields(existingSeason, seasonAggData.seasonMetadata)
        if (Object.keys(filtered).length > 0) {
          console.log(
            `Updating season-level metadata for "${show.title}" - Season ${seasonNumber}`
          )
          await client
            .db('Media')
            .collection('TV')
            .updateOne(
              { title: show.title },
              { $set: updateData },
              { arrayFilters: [{ 'elem.seasonNumber': Number(seasonNumber) }] }
            )
        }
      }
    }

    // --- 3) Finalize EPISODE-LEVEL METADATA ---
    // e.g. if you store it in `seasons[n].metadata.episodes`
    for (const [episodeNumber, episodeMetadata] of Object.entries(
      seasonAggData.episodes
    )) {
      // Find matching DB episode object
      const dbEpisode = existingSeason.episodes.find(
        (e) => e.episodeNumber === Number(episodeNumber)
      )
      if (!dbEpisode) continue

      const existingEpisodeLastUpdated = new Date(
        dbEpisode?.metadata?.last_updated || '1970-01-01'
      )
      const newEpisodeLastUpdated = new Date(
        episodeMetadata.last_updated || '1970-01-01'
      )

      const canUpdateEpisode = isCurrentServerHigherPriority(
        dbEpisode.metadataSource,
        { id: episodeMetadata.metadataSource }
      ) || !dbEpisode.metadataSource

      if (newEpisodeLastUpdated > existingEpisodeLastUpdated && canUpdateEpisode) {
        console.log(
          `Updating episode metadata for "${show.title}" S${seasonNumber}E${episodeNumber}`
        )

        // Filter locked fields
        const filtered = filterLockedFields(dbEpisode, episodeMetadata)
        if (Object.keys(filtered).length > 0) {
          // Build a partial update for that episode
          await updateEpisodeInDatabase(client, show.title, Number(seasonNumber), Number(episodeNumber), {
            set: {
              metadata: episodeMetadata,
              metadataSource: episodeMetadata.metadataSource
            }
          })
        }
      }
    }
  }
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
        showData.title ?? currentShow.title,
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
      showData.title ?? currentShow.title,
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
 * Gathers captions for a single movie across ALL servers, returns an object:
 * { languageName: { srcLang, url, lastModified, sourceServerId, priority } }
 * picking the highest priority if multiple servers have the same language.
 *
 * @param {Object} movie - The DB movie object (with movie.title, etc.).
 * @param {Object} fileServers - The entire fileServers object, keyed by serverId.
 * @returns {Object} - Aggregated captions for the movie. Possibly empty if no server has captions.
 */
export function gatherMovieCaptionsForAllServers(movie, fileServers) {
  const aggregated = {} // language => { srcLang, url, lastModified, sourceServerId, priority }

  // Iterate all servers
  for (const [serverId, fileServer] of Object.entries(fileServers)) {
    const serverConfig = {
      id: serverId,
      ...fileServer.config,
    }
    const fileServerMovieData = fileServer.movies?.[movie.title]
    if (!fileServerMovieData?.urls?.subtitles) {
      // This server has no subtitles for this movie
      continue
    }

    // Convert server's raw data into an object of { lang: { srcLang, url, lastModified, sourceServerId } }
    const serverCaptions = processCaptionURLs(fileServerMovieData.urls.subtitles, serverConfig)
    if (!serverCaptions) continue

    // Merge these into `aggregated`, respecting priority
    for (const [lang, subObj] of Object.entries(serverCaptions)) {
      const existing = aggregated[lang]
      if (!existing) {
        // If we have no data yet for this lang => take it
        aggregated[lang] = {
          ...subObj,
          priority: serverConfig.priority,
        }
      } else {
        // Compare priority, if the new server has a *higher* priority (numerically lower)
        // then overwrite
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
 * Given the aggregated data (highest-priority captions from all servers) for ONE movie,
 * compare to DB, remove orphans, add new, etc., then do a single update if something changed.
 *
 * @param {Object} client - DB client
 * @param {Object} movie - DB movie object (has movie.captionURLs, movie.captionSource, etc.)
 * @param {Object} aggregated - from gatherMovieCaptionsForAllServers
 *   shape: { [langName]: { srcLang, url, lastModified, sourceServerId, priority } }
 * @returns {boolean} Whether an update occurred
 */
export async function finalizeMovieCaptions(client, movie, aggregated) {
  // Build a final "captionURLs" that excludes the "priority" field
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

  // Compare
  if (isEqual(currentCaptions, finalCaptionURLs)) {
    // They match exactly => no update needed
    return false
  }

  // If different, we do an update
  // Decide which server ID to store in `captionSource`.
  // Typically, you'd pick the server ID from the "winning" set of captions.
  // For example, pick the first language's sourceServerId if it exists:
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
    newCaptionSource // or server id
  )

  return true
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
      show.title,
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
 * Processes chapter updates for a movie
 */
export async function processMovieChapters(
  client,
  movie,
  fileServerData,
  serverConfig,
  fieldAvailability
) {
  const fileServerUrls = fileServerData?.urls || {}

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

    if (!isHighestPriority) {
      console.log(
        `Skipping chapter update for "${movie.title}" - higher-priority server has chapters.`
      )
      return false
    }

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
 * Processes chapter updates for a TV episode
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

    if (!isHighestPriority) {
      console.log(
        `Skipping chapter update for "${showTitle}" Season ${seasonNumber}, Episode ${episode.episodeNumber} - higher-priority server has chapters.`
      )
      return null
    }

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
 * Processes chapter updates for a TV season
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
 * Processes the video URL update for a movie.
 * @param {Object} client - The database client.
 * @param {Object} movie - The movie object.
 * @param {Object} fileServerData - The data from the file server for the movie.
 * @param {Object} serverConfig - The configuration for the file server.
 * @param {Object} fieldAvailability - The availability of fields for the movie.
 * @returns {Promise<boolean|null>} - A Promise that resolves to true if the video URL was updated, null if the update was skipped.
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

  if (!isHighestPriority) {
    // console.log(
    //   `Skipping video URL update for "${movie.title}" - higher-priority server has videoURL.`
    // );
    return null
  }

  const newVideoURL = createFullUrl(fileServerData.urls.mp4, serverConfig)
  const hasSameData =
    movie.videoURL &&
    isEqual(movie.videoURL, newVideoURL) &&
    isSourceMatchingServer(movie, 'videoSource', serverConfig)
  if (hasSameData) return null

  // Only update if the current source is the same server or not set
  //if (movie.videoSource && isSourceMatchingServer(movie, 'videoSource', serverConfig)) {
    // console.log(
    //   `Skipping video URL update for "${movie.title}" - content owned by server ${movie.videoSource}`
    // );
    //return null
  //}

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
 * Processes the video URL update for a TV episode.
 * @param {Object} client - The database client.
 * @param {Object} episode - The TV episode object.
 * @param {Object} fileServerEpisodeData - The data from the file server for the episode.
 * @param {string} showTitle - The title of the TV show.
 * @param {number} seasonNumber - The season number of the TV show.
 * @param {Object} serverConfig - The configuration for the file server.
 * @returns {Promise<{videoURL: string, videoSource: string}|null>} - A Promise that resolves to an object with the updated video URL and source, or null if the update was skipped.
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

  if (!isHighestPriority) {
    // console.log(
    //   `Skipping video URL update for "${showTitle}" - Season ${seasonNumber}, Episode ${episode.episodeNumber} - higher-priority server has videoURL.`
    // );
    return null
  }

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
 * Processes the video URL updates for all episodes in a TV show season.
 * @param {Object} client - The database client.
 * @param {Object} show - The TV show object.
 * @param {Object} season - The TV season object.
 * @param {Object} fileServerShowData - The file server data for the TV show.
 * @param {Object} serverConfig - The configuration for the file server.
 * @returns {Promise<number>} - A Promise that resolves to the number of episodes updated.
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
 * Processes the logo URL update for a TV show, integrating fieldAvailability and priority checks.
 * @param {Object} client - The database client.
 * @param {Object} show - The TV show object.
 * @param {Object} fileServerData - The file server data for the TV show.
 * @param {Object} serverConfig - The server configuration.
 * @param {Object} fieldAvailability - The field availability map.
 * @returns {Promise<boolean|null>} - Returns true if the logo was updated, null otherwise.
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

  if (!isHighestPriority) {
    // console.log(
    //   `Skipping logo update for "${showTitle}" - higher-priority server has logo.`
    // );
    return null
  }

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
 * Processes the logo URL update for a movie, integrating fieldAvailability and priority checks.
 * @param {Object} client - The database client.
 * @param {Object} movie - The movie object.
 * @param {Object} fileServerData - The file server data for the movie.
 * @param {Object} serverConfig - The server configuration.
 * @param {Object} fieldAvailability - The field availability map.
 * @returns {Promise<boolean|null>} - Returns true if the logo was updated, null otherwise.
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

  if (!isHighestPriority) {
    // console.log(
    //   `Skipping logo update for "${movieTitle}" - higher-priority server has logo.`
    // );
    return null
  }

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
 * Processes the blurhash update for a TV season, integrating fieldAvailability and priority checks.
 * @param {Object} client - The database client.
 * @param {Object} season - The TV season object.
 * @param {Object} fileServerSeasonData - The file server data for the TV season.
 * @param {string} showTitle - The title of the TV show.
 * @param {Object} serverConfig - The server configuration.
 * @param {Object} fieldAvailability - The field availability map.
 * @returns {Promise<boolean|null>} - Returns true if the season was updated, null otherwise.
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

  if (!isHighestPriority) {
    // console.log(
    //   `Skipping blurhash update for "${showTitle}" Season ${seasonNumber} - higher-priority server has blurhash.`
    // )
    return null
  }

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
    console.log(
      `TV Season: Removing seasonPosterBlurhash for "${showTitle}" Season ${seasonNumber} from server ${serverConfig.id}`
    )
    const { seasonPosterBlurhash, seasonPosterBlurhashSource, ...seasonWithoutBlurhash } =
      updatedSeason
    updatedSeason = seasonWithoutBlurhash
    needsUpdate = true
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
      isSourceMatchingServer(season, 'seasonPosterBlurhashSource', serverConfig)
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
      await client
        .db('Media')
        .collection('TV')
        .updateOne({ title: showTitle }, updateOperation, {
          arrayFilters: [{ 'elem.seasonNumber': seasonNumber }],
        })

      await updateMediaUpdates(showTitle, MediaType.TV)
      return true
    }
  }

  return null
}

/**
 * Processes the blurhash update for a TV show, integrating fieldAvailability and priority checks.
 * @param {Object} client - The database client.
 * @param {Object} show - The TV show object.
 * @param {Object} fileServerData - The file server data for the TV show.
 * @param {Object} serverConfig - The server configuration.
 * @param {Object} fieldAvailability - The field availability map.
 * @returns {Promise<boolean|null>} - Returns true if the show was updated, null otherwise.
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
    showTitle,
    posterBlurhashFieldPath,
    serverConfig
  )

  if (hasPosterBlurhashData) {
    if (isPosterBlurhashHighestPriority) {
      const newPosterBlurhashURL = createFullUrl(fileServerData.posterBlurhash, serverConfig)

      if (!isEqual(show.posterBlurhash, newPosterBlurhashURL) || !show.posterBlurhashSource) {
        updates.posterBlurhash = newPosterBlurhashURL
        updates.posterBlurhashSource = serverConfig.id
      }
    } //else {
    // console.log(
    //   `Skipping posterBlurhash update for "${showTitle}" - higher-priority server has posterBlurhash.`
    // );
    //}
  } else if (
    show.posterBlurhash &&
    isSourceMatchingServer(show, 'posterBlurhashSource', serverConfig)
  ) {
    // Remove posterBlurhash if server is the source and serverData doesn't have it
    unsetFields.posterBlurhash = ''
    unsetFields.posterBlurhashSource = ''
  }

  // Process backdropBlurhash
  const backdropBlurhashFieldPath = 'backdropBlurhash'
  const hasBackdropBlurhashData = !!fileServerData.backdropBlurhash

  const isBackdropBlurhashHighestPriority = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    'tv',
    showTitle,
    backdropBlurhashFieldPath,
    serverConfig
  )

  if (hasBackdropBlurhashData) {
    if (isBackdropBlurhashHighestPriority) {
      const newBackdropBlurhashURL = createFullUrl(fileServerData.backdropBlurhash, serverConfig)

      if (!show.backdropBlurhashSource || !isEqual(show.backdropBlurhash, newBackdropBlurhashURL)) {
        // Check ownership
        updates.backdropBlurhash = newBackdropBlurhashURL
        updates.backdropBlurhashSource = serverConfig.id
      }
    } /*else {
      console.log(
        `Skipping backdropBlurhash update for "${showTitle}" - higher-priority server has backdropBlurhash.`
      )
    }*/
  } else if (
    show.backdropBlurhash &&
    isSourceMatchingServer(show, 'backdropBlurhashSource', serverConfig)
  ) {
    // Remove backdropBlurhash if server is the source and serverData doesn't have it
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
 * Processes the blurhash update for a movie's poster, integrating fieldAvailability and priority checks.
 * @param {Object} client - The database client.
 * @param {Object} movie - The movie object.
 * @param {Object} fileServerData - The file server data for the movie.
 * @param {Object} serverConfig - The server configuration.
 * @param {Object} fieldAvailability - The field availability map.
 * @returns {Promise<boolean|null>} - Returns true if the blurhash was updated, null otherwise.
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

  if (!isHighestPriority) {
    // console.log(
    //   `Skipping posterBlurhash update for "${movieTitle}" - higher-priority server has posterBlurhash.`
    // );
    return null
  }

  const newBlurhash = createFullUrl(fileServerData.urls.posterBlurhash, serverConfig)

  if (isSourceMatchingServer(media, 'posterBlurhashSource', serverConfig) && isEqual(movie.posterBlurhash, newBlurhash)) return null

  const updateData = {
    posterBlurhash: newBlurhash,
    posterBlurhashSource: serverConfig.id,
  }

  // Filter out any locked fields
  const filteredUpdateData = filterLockedFields(movie, updateData)

  if (!filteredUpdateData.posterBlurhash) {
    // console.log(
    //   `Field "posterBlurhash" is locked for movie "${movieTitle}". Skipping blurhash update.`
    // )
    return null
  }

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
 * Gathers video info for one (show, season) from ALL servers, 
 * picking the highest priority server's data for each field.
 *
 * @param {Object} show - DB show object (with .title, etc.)
 * @param {Object} season - DB season object (with .seasonNumber, .episodes)
 * @param {Object} fileServers - All servers, keyed by serverId
 * @returns {Object} aggregatedSeasonData
 *  {
 *    [episodeNumber]: {
 *      dimensions: { width, height } | null,
 *      duration: number | null,
 *      hdr: string | null,
 *      size: number | null,
 *      priorityMap: { dimensions: number, duration: number, hdr: number, size: number },
 *    }
 *  }
 */
export function gatherSeasonVideoInfoForAllServers(show, season, fileServers) {
  const aggregated = {}

  // For each server
  for (const [serverId, fileServer] of Object.entries(fileServers)) {
    const serverConfig = fileServer.config // includes .priority
    const fileServerShowData = fileServer.tv?.[show.title]
    if (!fileServerShowData) continue

    const seasonKey = `Season ${season.seasonNumber}`
    const fileServerSeasonData = fileServerShowData.seasons?.[seasonKey]
    if (!fileServerSeasonData?.episodes) continue

    // For each episode in the DB season
    for (const episode of season.episodes) {
      const episodeNumber = episode.episodeNumber
      const episodeFileName = findEpisodeFileName(
        Object.keys(fileServerSeasonData.episodes),
        season.seasonNumber,
        episodeNumber
      )
      if (!episodeFileName) continue

      const fileData = fileServerSeasonData.episodes[episodeFileName]
      if (!fileData) continue

      const additionalMetadata = fileData.additionalMetadata || {}
      const dimensions = fileServerSeasonData.dimensions?.[episodeFileName] || null
      const length =
        fileServerSeasonData.lengths?.[episodeFileName] ||
        additionalMetadata.duration ||
        null
      const hdr = fileData.hdr || null
      const size = additionalMetadata.size || null

      // Make sure we have an object for this episode
      if (!aggregated[episodeNumber]) {
        aggregated[episodeNumber] = {
          dimensions: null,
          duration: null,
          hdr: null,
          size: null,
          priorityMap: {
            dimensions: Infinity,
            duration: Infinity,
            hdr: Infinity,
            size: Infinity,
          },
        }
      }

      // Now, compare priorities for each field
      const epData = aggregated[episodeNumber]

      // If this server has `dimensions` and it's higher-priority (lower numeric value):
      if (dimensions && serverConfig.priority < epData.priorityMap.dimensions) {
        epData.dimensions = dimensions
        epData.priorityMap.dimensions = serverConfig.priority
      }

      // If this server has `duration`:
      if (length && serverConfig.priority < epData.priorityMap.duration) {
        epData.duration = length
        epData.priorityMap.duration = serverConfig.priority
      }

      // If this server has `hdr`:
      if (hdr && serverConfig.priority < epData.priorityMap.hdr) {
        epData.hdr = hdr
        epData.priorityMap.hdr = serverConfig.priority
      }

      // If this server has `size`:
      if (size && serverConfig.priority < epData.priorityMap.size) {
        epData.size = size
        epData.priorityMap.size = serverConfig.priority
      }

      // Also note: If a server *omits* a field (hdr = null), we do *not* forcibly remove it yet.
      // We only remove if *no* server has it or if the original server "owner" is gone.
      // We'll handle that in "finalize".
    }
  }

  return aggregated
}

/**
 * Compare aggregated video info vs. what's in the DB episodes. 
 * Update fields if changed, remove fields if no server has them (or no longer owns them).
 *
 * @param {Object} client - DB client
 * @param {Object} show - the DB show object
 * @param {Object} season - the DB season object
 * @param {Object} aggregatedSeasonData - result of gatherSeasonVideoInfoForAllServers
 */
export async function finalizeSeasonVideoInfo(client, show, season, aggregatedSeasonData) {
  for (const episode of season.episodes) {
    const episodeNumber = episode.episodeNumber
    const bestData = aggregatedSeasonData[episodeNumber]
    if (!bestData) {
      // Means no server had any data for this episode => might remove if the DB had something
      // But let's skip if we want to leave it alone if there's no new data
      continue
    }

    // Compare to existing
    // Fields: episode.dimensions, episode.duration, episode.hdr, episode.size
    // We see if they differ from bestData
    const changes = {}
    let changed = false

    // Compare each field
    if (!isEqual(episode.dimensions, bestData.dimensions)) {
      changes.dimensions = bestData.dimensions || null
      changed = true
    }
    if (episode.duration !== bestData.duration || episode.length !== bestData.duration) {
      changes.duration = bestData.duration || null
      changes.length = bestData.duration || null
      changed = true
    }
    if (episode.hdr !== bestData.hdr) {
      changes.hdr = bestData.hdr || null
      changed = true
    }
    if (episode.size !== bestData.size) {
      changes.size = bestData.size || null
      changed = true
    }

    // Ownership: if any field changed, we can set videoInfoSource to 
    // the highest-priority server that "won" the majority. 
    // Or just pick one field's priority. 
    if (changed) {
      // We'll just store the ID of whichever server had the highest priority for, say, the "dimensions" field.
      // You can do more robust logic if needed (like the highest among all changed fields).
      let finalSourceId = episode.videoInfoSource
      const minPriority = Math.min(
        bestData.priorityMap.dimensions,
        bestData.priorityMap.duration,
        bestData.priorityMap.hdr,
        bestData.priorityMap.size
      )
      // You can set finalSourceId by matching that priority to a server. 
      // That might require storing the serverId in your aggregated structure, 
      // or you can just store the numeric priority if you don’t need the exact ID.

      changes.videoInfoSource = finalSourceId // or some logic to find the correct server ID
      await updateEpisodeInDatabase(client, show.title, season.seasonNumber, episodeNumber, {
        set: changes,
      })

      console.log(
        `Updated video info for ${show.title} - Season ${season.seasonNumber}, Episode ${episodeNumber}`
      )
    } 
    else {
      // No changes
    }
  }
}

export async function syncSeasonVideoInfoAllServers(
  client,
  show,
  season,
  fileServers
) {
  // Phase 1: gather from all servers
  const aggregatedSeasonData = gatherSeasonVideoInfoForAllServers(show, season, fileServers)

  // Phase 2: finalize in DB
  await finalizeSeasonVideoInfo(client, show, season, aggregatedSeasonData)
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
  const length =
    fileServerSeasonData?.lengths[episodeFileName] || additionalMetadata?.duration || null
  const additionalMetadata = fileData.additionalMetadata || {}
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
          show.title,
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

/**
 * Compare the aggregated data to the DB movie's existing fields,
 * and do one update if something changed (including removing fields
 * if no server has them).
 *
 * @param {Object} client - DB client
 * @param {Object} movie - DB movie object
 * @param {Object} aggregated - from gatherMovieVideoInfoForAllServers
 *   { dimensions, length, hdr, size, priorityMap: {...} }
 */
export async function finalizeMovieVideoInfo(client, movie, aggregated) {
  const updates = {}
  let changed = false

  // Compare each field
  // 1) dimensions
  if (!isEqual(movie.dimensions, aggregated.dimensions)) {
    updates.dimensions = aggregated.dimensions || null
    changed = true
  }

  // 2) length => you call it "duration" in DB or "length"? Adjust accordingly
  if (!isEqual(movie.duration, aggregated.length)) {
    updates.duration = aggregated.length || null
    changed = true
  }

  // 3) hdr
  if (!isEqual(movie.hdr, aggregated.hdr)) {
    updates.hdr = aggregated.hdr || null
    changed = true
  }

  // 4) size
  if (!isEqual(movie.size, aggregated.size)) {
    updates.size = aggregated.size || null
    changed = true
  }
  
  // 5) videoInfoSource
  if (!isEqual(movie.videoInfoSource, aggregated.videoInfoSource)) {
    updates.videoInfoSource = aggregated.videoInfoSource || null
    changed = true
  }

  // If changed, also set "videoInfoSource" if you want
  // We haven't stored the actual winning serverId, only priority. 
  // If you want to store the ID, you'd need to keep track of it 
  // in the aggregator. 
  if (changed) {
    console.log(`Updating video info for movie "${movie.title}"...`)
    await updateMediaInDatabase(
      client,
      MediaType.MOVIE,
      movie.title,
      { $set: updates }
    )
  }
}

/**
 * Gathers video info for a single movie across ALL servers, 
 * returning the highest priority data for each field (dimensions, duration, hdr, size).
 *
 * @param {Object} movie - DB movie object (with .title, .dimensions, .hdr, etc.)
 * @param {Object} fileServers - All servers keyed by serverId
 * @returns {Object} aggregatedData 
 *   { dimensions, length, hdr, size, priorityMap: {...} }
 */
export function gatherMovieVideoInfoForAllServers(movie, fileServers) {
  const aggregated = {
    dimensions: null,
    length: null,
    hdr: null,
    size: null,
    priorityMap: {
      dimensions: Infinity,
      length: Infinity,
      hdr: Infinity,
      size: Infinity,
    },
    videoInfoSource: null,
  }

  for (const [serverId, fileServer] of Object.entries(fileServers)) {
    const serverConfig = {
      id: serverId,
      ...fileServer.config,
    }
    const fileServerData = fileServer.movies?.[movie.title]
    if (!fileServerData?.fileNames) continue

    // Example from your code: find the mp4
    const mp4File = fileServerData.fileNames.find((n) => n.endsWith('.mp4'))
    if (!mp4File) continue

    const newDimensions = fileServerData.dimensions?.[mp4File]
    const newLength = fileServerData.length?.[mp4File]
    const newHdr = fileServerData.hdr
    const newSize = fileServerData?.additional_metadata?.size

    // Compare priorities for each field
    if (newDimensions && serverConfig.priority < aggregated.priorityMap.dimensions) {
      aggregated.dimensions = newDimensions
      aggregated.priorityMap.dimensions = serverConfig.priority
    }
    if (newLength && serverConfig.priority < aggregated.priorityMap.length) {
      aggregated.length = newLength
      aggregated.priorityMap.length = serverConfig.priority
    }
    if (newHdr && serverConfig.priority < aggregated.priorityMap.hdr) {
      aggregated.hdr = newHdr
      aggregated.priorityMap.hdr = serverConfig.priority
    }
    if (newSize && serverConfig.priority < aggregated.priorityMap.size) {
      aggregated.size = newSize
      aggregated.priorityMap.size = serverConfig.priority
    }
    // Add in serverId
    aggregated.videoInfoSource = serverConfig.id
  }

  return aggregated
}

/**
 * Processes video information for a movie from a file server, integrating fieldAvailability and priority checks.
 *
 * @param {Object} client - The database client to use for updates.
 * @param {Object} movie - The movie object containing current video information.
 * @param {Object} fileServerData - The video information data from the file server.
 * @param {Object} serverConfig - The configuration for the file server.
 * @param {Object} fieldAvailability - The field availability map.
 * @returns {Promise<boolean|null>} - Returns true if the movie's video info was updated, null otherwise.
 */
export async function processMovieVideoInfo(
  client,
  movie,
  fileServerData,
  serverConfig,
  fieldAvailability
) {
  if (!fileServerData?.fileNames) {
    // console.warn(`No fileNames found for movie "${movie.title}" on server ${serverConfig.id}. Skipping video info updates.`)
    return null
  }

  const mp4File = fileServerData.fileNames.find((name) => name.endsWith('.mp4'))
  if (!mp4File) {
    console.warn(
      `No .mp4 file found for movie "${movie.title}" on server ${serverConfig.id}. Skipping video info updates.`
    )
    return null
  }

  const fieldsToCheck = {
    dimensions: fileServerData.dimensions[mp4File],
    length: fileServerData.length[mp4File],
    hdr: fileServerData.hdr,
    size: fileServerData?.additional_metadata.size,
  }

  const updates = {}

  for (const [field, newValue] of Object.entries(fieldsToCheck)) {
    if (newValue && movie[field] !== newValue) {
      // Construct fieldPath
      const fieldPath = 'hdr'

      // Check priority
      const isHighestPriority = isCurrentServerHighestPriorityForField(
        fieldAvailability,
        'movies',
        movie.title,
        fieldPath,
        serverConfig
      )

      if (!isHighestPriority) {
        console.log(
          `Skipping update for field "${field}" of movie "${movie.title}" - higher-priority server has data.`
        )
        continue
      }

      // Verify ownership
      if (
        movie.videoInfoSource &&
        !isSourceMatchingServer(movie, 'videoInfoSource', serverConfig)
      ) {
        console.log(
          `Cannot update field "${field}" for movie "${movie.title}" - owned by server ${movie.videoInfoSource}.`
        )
        continue
      }

      updates[field] = newValue
      updates.videoInfoSource = serverConfig.id // Update source to current server
    }
  }

  // Check for HDR removal
  if (
    !fileServerData.hdr &&
    movie.hdr &&
    isSourceMatchingServer(movie, 'videoInfoSource', serverConfig)
  ) {
    const fieldPath = `hdr`
    const isHighestPriority = isCurrentServerHighestPriorityForField(
      fieldAvailability,
      'movies',
      movie.title,
      fieldPath,
      serverConfig
    )

    if (isHighestPriority) {
      updates.$unset = { hdr: '' }
      updates.videoInfoSource = serverConfig.id
      console.log(`Removing HDR for movie "${movie.title}" from server ${serverConfig.id}`)
    }
  }

  // Check size separately if needed
  if (
    fileServerData?.additional_metadata.size &&
    movie.size !== fileServerData?.additional_metadata.size
  ) {
    const fieldPath = `additional_metadata.size`
    const isHighestPriority = isCurrentServerHighestPriorityForField(
      fieldAvailability,
      'movies',
      movie.title,
      fieldPath,
      serverConfig
    )

    if (isHighestPriority) {
      updates.size = fileServerData.additional_metadata.size
      updates.videoInfoSource = serverConfig.id
    }
  }

  // Set videoInfoSource if not set
  if (
    !movie.videoInfoSource &&
    (updates.length || updates.dimensions || updates.hdr || updates.size)
  ) {
    updates.videoInfoSource = serverConfig.id
  }

  if (Object.keys(updates).length > 0) {
    console.log(`Movie: Updating video info for "${movie.title}" from server ${serverConfig.id}`)
    const preparedUpdateData = {
      $set: updates,
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

  return null
}

/**
 * Processes season thumbnails for a TV show, integrating fieldAvailability and priority checks.
 *
 * @param {Object} client - The database client.
 * @param {Object} show - The TV show object.
 * @param {Object} season - The season object.
 * @param {Object} fileServerShowData - The file server data for the TV show.
 * @param {Object} serverConfig - The server configuration.
 * @param {Object} fieldAvailability - The field availability map.
 * @returns {Promise<number>} - The number of episodes that were updated.
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
  if (!fileServerSeasonData?.episodes) {
    //console.warn(`No URLs found for "${show.title}" Season ${season.seasonNumber} on server ${serverConfig.id}. Skipping thumbnail updates.`)
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
 * Processes episode thumbnails and blurhash URLs from file server data, integrating fieldAvailability and priority checks.
 *
 * @param {Object} client - The database client.
 * @param {Object} episode - The episode object.
 * @param {Object} fileServerEpisodeData - The file server data for the episode.
 * @param {string} showTitle - The title of the TV show.
 * @param {number} seasonNumber - The season number.
 * @param {number} episodeNumber - The episode number.
 * @param {Object} serverConfig - The server configuration.
 * @param {Object} fieldAvailability - The field availability map.
 * @returns {Promise<Object|null>} - An object containing the updated thumbnail and blurhash URLs if changes were needed, null otherwise.
 */
export async function processEpisodeThumbnails(
  client,
  episode,
  fileServerEpisodeData,
  episodeFileName,
  showTitle,
  seasonNumber,
  episodeNumber,
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
        } /* else {
          console.log(`Cannot update thumbnail for "${showTitle}" S${seasonNumber}E${episodeNumber} - owned by server ${episode.thumbnailSource}.`)
        } */
      } /*else {
        console.log(
          `Skipping thumbnail update for "${showTitle}" S${seasonNumber}E${episodeNumber} - higher-priority server has thumbnail.`
        )
      }*/
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
        } /* else {
          console.log(`Cannot update thumbnailBlurhash for "${showTitle}" S${seasonNumber}E${episodeNumber} - owned by server ${episode.thumbnailBlurhashSource}.`)
        } */
      } /* else {
        console.log(`Skipping thumbnailBlurhash update for "${showTitle}" S${seasonNumber}E${episodeNumber} - higher-priority server has thumbnailBlurhash.`)
      } */
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
        `Removing thumbnailBlurhash for "${showTitle}" S${seasonNumber}E${episodeNumber} from server ${serverConfig.id}`
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
        `Removing thumbnail for "${showTitle}" S${seasonNumber}E${episodeNumber} from server ${serverConfig.id}`
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
 * Processes show poster URL updates, integrating fieldAvailability and priority checks.
 *
 * @param {Object} client - The database client.
 * @param {Object} show - The TV show object.
 * @param {Object} fileServerData - The file server data for the show.
 * @param {Object} serverConfig - The server configuration.
 * @param {Object} fieldAvailability - The field availability map.
 * @returns {Promise<boolean|null>} - Returns true if the show was updated, null otherwise.
 */
export async function processShowPosterURL(
  client,
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

  if (!isHighestPriority) {
    console.log(
      `Skipping poster URL update for "${showTitle}" - higher-priority server has poster.`
    )
    return null
  }

  const newPosterURL = createFullUrl(fileServerData.poster, serverConfig)

  // Verify ownership: only update if the current server owns the poster or if it's unset
  // if (show.posterSource && !isSourceMatchingServer(show, 'posterSource', serverConfig)) {
  //   console.log(
  //     `Cannot update poster URL for "${showTitle}" - poster is owned by server ${show.posterSource}.`
  //   )
  //   return null
  // }

  if (
    show.posterSource &&
    isEqual(show.poster, newPosterURL) &&
    isSourceMatchingServer(show, 'posterSource', serverConfig)
  )
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
  const preparedUpdateData = {
    $set: filteredUpdateData,
  }
  await updateMediaInDatabase(client, MediaType.TV, showTitle, preparedUpdateData, serverConfig.id)
  return true
}

/**
 * Processes movie poster URL updates, integrating fieldAvailability and priority checks.
 *
 * @param {Object} client - The database client.
 * @param {Object} movie - The movie object.
 * @param {Object} fileServerData - The file server data for the movie.
 * @param {Object} serverConfig - The server configuration.
 * @param {Object} fieldAvailability - The field availability map.
 * @returns {Promise<boolean|null>} - Returns true if the movie was updated, null otherwise.
 */
export async function processMoviePosterURL(
  client,
  movie,
  fileServerData,
  serverConfig,
  fieldAvailability
) {
  if (!fileServerData.urls?.posterURL) return null

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

  if (!isHighestPriority) {
    console.log(
      `Skipping poster URL update for movie "${movieTitle}" - higher-priority server has posterURL.`
    )
    return null
  }

  const newPosterURL = createFullUrl(fileServerData.urls.posterURL, serverConfig)

  // // Verify ownership: only update if the current server owns the poster or if it's unset
  // if (movie.posterSource && !isSourceMatchingServer(movie, 'posterSource', serverConfig)) {
  //   console.log(
  //     `Cannot update poster URL for movie "${movieTitle}" - poster is owned by server ${movie.posterSource}.`
  //   )
  //   return null
  // }

  if (
    movie.posterSource &&
    isEqual(movie.posterURL, newPosterURL) &&
    isSourceMatchingServer(movie, 'posterSource', serverConfig)
  )
    return null

  const updateData = {
    posterURL: newPosterURL,
    posterSource: serverConfig.id,
  }

  // Filter out any locked fields
  const filteredUpdateData = filterLockedFields(movie, updateData)

  if (!filteredUpdateData.posterURL) {
    console.log(
      `Field "posterURL" is locked for movie "${movieTitle}". Skipping poster URL update.`
    )
    return null
  }

  console.log(`Movie: Updating poster URL for "${movieTitle}" from server ${serverConfig.id}`)
  return filteredUpdateData
}

/**
 * Processes season poster updates for a list of seasons, integrating fieldAvailability and priority checks.
 *
 * @param {Object} client - The database client.
 * @param {string} showTitle - The title of the show.
 * @param {Array<Object>} seasons - The list of seasons to process.
 * @param {Object} fileServerData - The data from the file server.
 * @param {Object} serverConfig - The server configuration.
 * @param {Object} fieldAvailability - The field availability map.
 * @returns {Promise<{ updatedSeasons: Array<Object>, hasUpdates: boolean }>} - Updated seasons and a flag indicating if any updates were made.
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

      if (!isHighestPriority) {
        // console.log(
        //   `Skipping season_poster update for "${showTitle}" Season ${season.seasonNumber} - higher-priority server has season_poster.`
        // )
        // updatedSeasons.push(season)
        return
      }

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
        //updatedSeason = { ...updatedSeason }
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

        // Prevent updates to fields that are locked
        const filteredUpdateData = filterLockedFields(season, updatedSeason)

        // **4. Preparing MongoDB Update Operations**

        const setFields = {}
        const unsetFields = {}

        if (filteredUpdateData.season_poster) {
          setFields['seasons.$[elem].season_poster'] = filteredUpdateData.season_poster
          setFields['seasons.$[elem].posterSource'] = serverConfig.id
        }

        if (!filteredUpdateData.season_poster && (season.season_poster || season.posterSource)) {
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
                { title: showTitle }, // Ensure the query correctly identifies the document
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
            // Optionally, you could push to an errors array similar to syncBackdrop
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
 * Processes backdrop updates for media items (TV shows or movies), integrating fieldAvailability and priority checks.
 *
 * @param {Object} media - The media object (TV show or movie).
 * @param {Object} fileServerData - The file server data containing backdrop information.
 * @param {Object} serverConfig - The server configuration.
 * @param {Object} fieldAvailability - The field availability map.
 * @returns {Object|null} - Returns an updates object if the media should be updated, null otherwise.
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
    mediaTitle,
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
    } /*else {
      console.log(
        `Skipping backdrop update for "${mediaTitle}" - higher-priority server has backdrop.`
      )
    }*/
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
    mediaTitle,
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
    } /*else {
      console.log(
        `Skipping backdropBlurhash update for "${mediaTitle}" - higher-priority server has it.`
      )
    }*/
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

function shouldUpdateSeason(showMetadata, season) {
  return (
    new Date(showMetadata.seasons?.last_updated) >
    new Date(season.metadata.episodes?.last_updated ?? '2024-01-01T01:00:00.000000')
  )
}

/**
 * Checks if a media item's source matches a server configuration ID
 * @param {Object} item - The media item (movie, episode, etc.)
 * @param {string} sourceKey - The key to check (e.g., 'posterBlurhashSource', 'videoInfoSource')
 * @param {Object} serverConfig - The server configuration object containing an ID
 * @param {string} serverConfig.id - The server configuration ID to check against
 * @returns {boolean} Returns true if the source matches the server config ID
 */
const isSourceMatchingServer = (item, sourceKey, serverConfig) => {
  if (!item || !sourceKey || !serverConfig?.id) {
    return false
  }

  return item[sourceKey] && item[sourceKey] === serverConfig.id
}

/**
 * Determines whether the current server is the highest priority among servers that have data for a specific field path.
 * @param {Object} fieldAvailability - The field availability map.
 * @param {string} mediaType - The type of media ('movies' or 'tv').
 * @param {string} mediaTitle - The title of the media item.
 * @param {string} fieldPath - The dot-separated path to the field.
 * @param {Object} serverConfig - The current server configuration.
 * @returns {boolean} - True if the current server is the highest priority server with data for the field path.
 */
function isCurrentServerHighestPriorityForField(
  fieldAvailability,
  mediaType,
  mediaTitle,
  fieldPath,
  serverConfig
) {
  const serversWithData = fieldAvailability[mediaType][mediaTitle]?.[fieldPath] || []
  if (serversWithData.length === 0) {
    // No server provides this field currently, so current server can proceed.
    //debugger
    return true
  }

  // Among the servers that currently have this field, find the one with the highest priority (lowest priority number).
  const highestPriority = serversWithData.reduce((minPriority, serverId) => {
    const server = getServer(serverId)
    if (!server) return minPriority
    return Math.min(minPriority, server.priority)
  }, Infinity)

  return serverConfig.priority <= highestPriority
}

/**
 * Synchronizes movie data across all servers.
 * @param {Object} client - The client object used for making API requests.
 * @param {Object} currentDB - The current database object containing movie data.
 * @param {Object[]} fileServers - The list of file servers to gather data from.
 * @returns {Promise} - A promise that resolves when the movie data synchronization is complete.
 */
export async function syncMovieDataAllServers(client, currentDB, fileServers) {
  // 1) Movies
  for (const movie of currentDB.movies) {
    // Phase 1: Gather
    const aggregatedMetadata = await gatherMovieMetadataForAllServers(movie, fileServers)
    const aggregatedCaptions = gatherMovieCaptionsForAllServers(movie, fileServers)
    const aggregatedVideoInfo = gatherMovieVideoInfoForAllServers(movie, fileServers)
    
    // Phase 2: Finalize
    await finalizeMovieMetadata(client, movie, aggregatedMetadata)
    await finalizeMovieCaptions(client, movie, aggregatedCaptions)
    await finalizeMovieVideoInfo(client, movie, aggregatedVideoInfo)
  }
}

/**
 * Synchronizes TV data across all servers.
 * @param {Object} client - The client object used for making API requests.
 * @param {Object} currentDB - The current database object containing TV show data.
 * @param {Object[]} fileServers - The list of file servers to gather data from.
 * @returns {Promise} - A promise that resolves when the TV data synchronization is complete.
 */
export async function syncTVDataAllServers(client, currentDB, fileServers) {
  // 1) TV
  for (const show of currentDB.tv) {
    const aggregatedTVMetadata = await gatherTvMetadataForAllServers(show, fileServers);
    // 2) Seasons
    for (const season of show.seasons) {
      // Phase 1: Gather
      const aggregatedCaptions = gatherSeasonCaptionsForAllServers(show, season, fileServers)
      const aggregatedVideoInfo = gatherSeasonVideoInfoForAllServers(show, season, fileServers)
      // Phase 2: Finalize
      await finalizeSeasonCaptions(client, show, season, aggregatedCaptions)
      await finalizeSeasonVideoInfo(client, show, season, aggregatedVideoInfo)
    }
    await finalizeTvMetadata(client, show, aggregatedTVMetadata)
  }
}