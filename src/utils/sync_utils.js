import { isEqual } from "lodash"
import { updateMediaUpdates } from "./admin_frontend_database"
import { fetchMetadataMultiServer } from "./admin_utils"
import { multiServerHandler } from "./config"

// Constants and Types
export const MediaType = {
  TV: 'tv',
  MOVIE: 'movie'
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
  return fileNames.find(fileName => {
    const fileNameWithoutExtension = fileName.slice(0, -4)
    const episodeNumberRegex = new RegExp(
      `(S?${seasonNumber.toString().padStart(2, '0')}E${episodeNumber.toString().padStart(2, '0')})|^${episodeNumber.toString().padStart(2, '0')}\\s?-`,
      'i'
    )
    return episodeNumberRegex.test(fileNameWithoutExtension)
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
 * @param {Object} client - The MongoDB client connection.
 * @param {string} showTitle - The title of the TV show.
 * @param {number} seasonNumber - The season number of the episode.
 * @param {number} episodeNumber - The episode number.
 * @param {Object} updates - An object containing the updates to apply to the episode.
 * @returns {Promise<Object>} - The result of the updateOne operation.
 */
export async function updateEpisodeInDatabase(client, showTitle, seasonNumber, episodeNumber, updates) {
  const updateFields = {}
  for (const [key, value] of Object.entries(updates)) {
    updateFields[`seasons.$.episodes.$[episode].${key}`] = value
  }
  
  return client
    .db('Media')
    .collection('TV')
    .updateOne(
      {
        title: showTitle,
        'seasons.seasonNumber': seasonNumber,
        'seasons.episodes.episodeNumber': episodeNumber
      },
      { $set: updateFields },
      { arrayFilters: [{ 'episode.episodeNumber': episodeNumber }] }
    )
}

/**
 * Updates media data in the database.
 *
 * This function updates the specified media item (TV show or movie) in the appropriate collection of the Media database. It takes the MongoDB client connection, the media type, the title of the media, and an object of updates to apply.
 *
 * @param {Object} client - The MongoDB client connection.
 * @param {string} mediaType - The type of media, either 'TV' or 'Movies'.
 * @param {string} title - The title of the media item.
 * @param {Object} updateData - An object containing the updates to apply to the media item.
 * @returns {Promise<void>} - A Promise that resolves when the update operation is complete.
 */
export async function updateMediaInDatabase(client, mediaType, title, updateData) {
  const collection = mediaType === MediaType.TV ? 'TV' : 'Movies'
  await client
    .db('Media')
    .collection(collection)
    .updateOne({ title }, { $set: updateData }, { upsert: true })
    
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
      episodes: []
    }

    for (const episode of episodes) {
      const episodeMatch = matchEpisodeFileName(episode.fileName)
      if (!episodeMatch) continue

      const { episodeNumber, title } = extractEpisodeDetails(episodeMatch)

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
          seasonMetadata.episodes = seasonMetadata.episodes || []
          seasonMetadata.episodes.push(episodeMetadata)
        } catch (error) {
          console.error(`Error fetching metadata for episode ${episodeNumber} of ${showTitle}:`, error)
        }
      }

      // Check if the episode already exists
      const existingEpisode = currentSeason.episodes.find((e) => e.episodeNumber === episodeNumber)
      if (!existingEpisode) {
        // Construct videoURL using the handler
        const videoURL = createFullUrl(fileServer.tv[showTitle].seasons[seasonIdentifier].urls[episode.fileName].videourl, serverConfig)

        // Initialize updatedData with required fields
        let updatedData = {
          episodeNumber: episodeNumber,
          title: title,
          videoURL: videoURL,
          mediaLastModified: episode.mediaLastModified,
          length: episode.length,
          dimensions: episode.dimensions,
        }

        // Add thumbnail if available
        if (episode.thumbnail) {
          updatedData.thumbnail = createFullUrl(fileServer.tv[showTitle].seasons[seasonIdentifier].urls[episode.fileName].thumbnail, serverConfig)
        }

        // Add thumbnailBlurhash if available
        if (episode.thumbnailBlurhash) {
          updatedData.thumbnailBlurhash = createFullUrl(fileServer.tv[showTitle].seasons[seasonIdentifier].urls[episode.fileName].thumbnailBlurhash, serverConfig)
        }

        if (episode.thumbnailSource) {
          updatedData.thumbnailSource = serverConfig.id
        }

        // Process captions
        const captions = fileServer.tv[showTitle].seasons[seasonIdentifier].urls[episode.fileName].subtitles
        if (captions) {
          updatedData.captionURLs = {}
          for (const [lang, captionData] of Object.entries(captions)) {
            updatedData.captionURLs[lang] = {
              srcLang: captionData.srcLang,
              url: createFullUrl(captionData.url, serverConfig),
              lastModified: captionData.lastModified,
            }
          }
        }

        // Add chapterURL if exists
        const chapters = fileServer.tv[showTitle].seasons[seasonIdentifier].urls[episode.fileName].chapters
        if (chapters) {
          updatedData.chapterURL = createFullUrl(chapters, serverConfig)
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
    if (!seasonInfo) {
      throw new Error('Season info is undefined')
    }

    const seasonIdentifier = seasonInfo.season || seasonInfo
    if (typeof seasonInfo === 'string') {
      return {
        number: parseInt(seasonInfo.split(' ')[1]),
        seasonIdentifier: seasonIdentifier,
        season_poster: fileServer?.tv[showTitle].seasons[seasonInfo].season_poster,
        posterSource: serverConfig.id,
        seasonPosterBlurhash: fileServer?.tv[showTitle].seasons[seasonInfo].seasonPosterBlurhash,
        seasonPosterBlurhashSource: serverConfig.id,
        episodes: fileServer?.tv[showTitle].seasons[seasonInfo].fileNames.map(function (fileName) {
          let returnData = {
            fileName,
            videoURL: fileServer?.tv[showTitle].seasons[seasonInfo].urls[fileName].videourl,
            length: fileServer?.tv[showTitle].seasons[seasonInfo].lengths[fileName],
            dimensions: fileServer?.tv[showTitle].seasons[seasonInfo].dimensions[fileName],
            mediaLastModified: new Date(
              fileServer?.tv[showTitle].seasons[seasonInfo].urls[fileName].mediaLastModified
            ),
          }
          if (fileServer?.tv[showTitle].seasons[seasonInfo].urls[fileName].thumbnail) {
            returnData.thumbnail =
              fileServer?.tv[showTitle].seasons[seasonInfo].urls[fileName].thumbnail
          }
          if (fileServer?.tv[showTitle].seasons[seasonInfo].urls[fileName].thumbnailBlurhash) {
            returnData.thumbnailBlurhash =
              fileServer?.tv[showTitle].seasons[seasonInfo].urls[fileName].thumbnailBlurhash
            returnData.thumbnailSource = serverConfig.id
          }
          if (fileServer?.tv[showTitle].seasons[seasonInfo].urls[fileName].metadata) {
            returnData.metadata =
              fileServer?.tv[showTitle].seasons[seasonInfo].urls[fileName].metadata
          }
          return returnData
        }),
      }
    } else {
      if (!seasonInfo.season) {
        throw new Error('Season number is undefined')
      }

      return {
        number: parseInt(seasonInfo.season.split(' ')[1]),
        seasonIdentifier: seasonIdentifier,
        season_poster: fileServer?.tv[showTitle].seasons[seasonIdentifier].season_poster,
        posterSource: serverConfig.id,
        seasonPosterBlurhash:
          fileServer?.tv[showTitle].seasons[seasonIdentifier].seasonPosterBlurhash,
        seasonPosterBlurhashSource: serverConfig.id,
        episodes: seasonInfo.missingEpisodes.map(function (episode) {
          let returnData = {
            fileName: episode.episodeFileName,
            videoURL: episode.videourl,
            mediaLastModified: new Date(episode.mediaLastModified),
            length: episode.lengths,
            dimensions: episode.dimensions,
          }
          if (episode.thumbnail) {
            returnData.thumbnail = episode.thumbnail
          }
          if (episode.thumbnailBlurhash) {
            returnData.thumbnailBlurhash = episode.thumbnailBlurhash
            returnData.thumbnailSource = serverConfig.id
          }
          if (episode.metadata) {
            returnData.metadata = episode.metadata
          }
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
  const mp4File = movieData.fileNames.find(name => name.endsWith('.mp4'))
  if (!mp4File) {
    console.log(`Movie: No MP4 file found for ${movieTitle}. Skipping.`)
    return null
  }

  const movieMetadata = await fetchMetadataMultiServer(serverConfig.id, movieData.urls?.metadata, 'file', 'movie', movieTitle)
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
    { name: 'backdropBlurhash' }
  ]

  const updateData = {
    title: movieTitle,
    videoURL: createFullUrl(movieData.urls.mp4, serverConfig),
    mediaLastModified: new Date(movieData.urls.mediaLastModified),
    length: movieData.length[mp4File],
    dimensions: movieData.dimensions[mp4File],
    metadata: movieMetadata,
  }

  for (const field of urlFields) {
    const fileServerValue = movieData.urls[field.name]
    if (fileServerValue) {
      updateData[field.dbField || field.name] = createFullUrl(fileServerValue, serverConfig)
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
    backdrop: createFullUrl(showData.backdrop, serverConfig),
    backdropBlurhash: createFullUrl(showData.backdropBlurhash, serverConfig),
    ...(showData.logo && { logo: createFullUrl(showData.logo, serverConfig) })
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

  const currentShow = await client
    .db('Media')
    .collection('TV')
    .findOne({ title: showTitle }) || { seasons: [] }

  // Update all seasons concurrently
  await Promise.all(
    show.seasons.map(seasonInfo =>
      addOrUpdateSeason(
        currentShow, 
        seasonInfo, 
        showTitle, 
        fileServer, 
        showMetadata,
        serverConfig
      )
    )
  )

  currentShow.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber)
  
  const showUpdateData = processShowData(
    showData, 
    showMetadata, 
    currentShow, 
    serverConfig
  )
  
  await updateMediaInDatabase(
    client, 
    MediaType.TV, 
    showTitle, 
    showUpdateData,
    serverConfig.id
  )
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

  const updateData = await processMovieData(
    movieTitle, 
    movieData, 
    serverConfig
  )
  
  if (!updateData) return
  
  await updateMediaInDatabase(
    client, 
    MediaType.MOVIE, 
    movieTitle, 
    updateData,
    serverConfig.id
  )
}

/**
 * Processes movie metadata updates
 * @param {Object} client - Database client
 * @param {Object} currentMovieData - Current movie data in database
 * @param {Object} fileServerMovieData - Movie data from file server
 * @param {Object} serverConfig - Server configuration
 */
export async function processMovieMetadata(client, currentMovieData, fileServerMovieData, serverConfig) {
  if (!fileServerMovieData) {
    throw new Error(`Movie "${currentMovieData.title}" not found in server ${serverConfig.id} data`)
  }

  const movieMetadata = await fetchMetadataMultiServer(
    serverConfig.id,
    fileServerMovieData.urls?.metadata,
    'file',
    'movie',
    currentMovieData.title
  )

  if (!movieMetadata) {
    throw new Error(`No metadata found for movie "${currentMovieData.title}" on server ${serverConfig.id}`)
  }

  // Ensure release_date is a Date object
  if (typeof movieMetadata.release_date !== 'object') {
    movieMetadata.release_date = new Date(movieMetadata.release_date)
  }

  const existingMetadataLastUpdated = new Date(
    currentMovieData.metadata?.last_updated ?? '1970-01-01T00:00:00.000Z'
  )
  const newMetadataLastUpdated = new Date(movieMetadata.last_updated)

  if (newMetadataLastUpdated > existingMetadataLastUpdated) {
    const updateData = { 
      metadata: movieMetadata,
      metadataSource: serverConfig.id
    }
    const filteredUpdateData = filterLockedFields(currentMovieData, updateData)

    if (filteredUpdateData.metadata && Object.keys(filteredUpdateData.metadata).length === 0) {
      delete filteredUpdateData.metadata
    }

    if (Object.keys(filteredUpdateData).length > 0) {
      console.log(`Movie: Updating metadata for "${currentMovieData.title}" from server ${serverConfig.id}`)
      await updateMediaInDatabase(
        client, 
        MediaType.MOVIE, 
        currentMovieData.title, 
        filteredUpdateData,
        serverConfig.id
      )
    } else {
      console.log(
        `All metadata fields are locked for movie "${currentMovieData.title}" on server ${serverConfig.id}. Skipping update.`
      )
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
  serverConfig
) {
  const episodeData = fileServerUrls[episodeFileName] ?? { metadata: null }
  const mostRecent_episodeMetadata = await fetchMetadataMultiServer(
    serverConfig.id,
    episodeData.metadata,
    'file',
    'tv',
    showTitle
  )

  if (!mostRecent_episodeMetadata) {
    console.error(
      `TV: Metadata fetch failed for ${episodeFileName} in ${showTitle} on server ${serverConfig.id}`,
      episodeData.metadata
    )
    return null
  }

  const currentEpisodeMetadata = currentSeasonData.metadata.episodes.find(
    (e) => e.episode_number === episode.episode_number && 
          e.season_number === episode.season_number
  )

  const needsUpdate = currentEpisodeMetadata && 
    new Date(mostRecent_episodeMetadata.last_updated) >
    new Date(currentEpisodeMetadata.last_updated ?? '2024-01-01T01:00:00.000000')

  if (needsUpdate) {
    console.log(
      `TV: Updating episode metadata for ${showTitle} Season ${seasonNumber} E${episode.episode_number} from server ${serverConfig.id}`
    )
    return {
      ...mostRecent_episodeMetadata,
      metadataSource: serverConfig.id
    }
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
 * @returns {Promise<void>} - A Promise that resolves when the season metadata updates are processed.
 */
export async function processSeasonMetadata(
  client,
  season,
  showData,
  currentShow,
  showMetadata,
  tvMetadata,
  serverConfig
) {
  const seasonNumber = season.seasonNumber
  const fileServerSeasonData = showData.seasons[`Season ${seasonNumber}`]
  
  if (!fileServerSeasonData) {
    return null
  }

  let seasonNeedsUpdate = false
  const updatedEpisodes = []

  for (const episodeFileName of fileServerSeasonData.urls) {
    try {
      const episode = season.episodes.find(
        (e) => e.videoURL.indexOf(episodeFileName)
      )
      if (!episode) {
        console.error(
          `Error: Episode "${episodeFileName}" not found in season ${seasonNumber} of ${showData.title ?? currentShow.title} on server ${serverConfig.id}`
        )
        continue
      }

      const updatedMetadata = await processEpisodeMetadata(
        episode,
        episodeFileName,
        fileServerSeasonData.urls,
        season,
        showData.title,
        seasonNumber,
        serverConfig
      )

      if (updatedMetadata) {
        seasonNeedsUpdate = true
        updatedEpisodes.push(updatedMetadata)
      }
    } catch (error) {
      console.error(
        `Error processing episode "${episodeFileName}" in ${showData.title} Season ${seasonNumber} on server ${serverConfig.id}:`,
        error
      )
    }
  }

  if (seasonNeedsUpdate || shouldUpdateSeason(showMetadata, season)) {
    const updatedSeasonData = {
      ...tvMetadata.seasons.find((s) => s.season_number === seasonNumber),
      episodes: updatedEpisodes,
      metadataSource: serverConfig.id
    }

    await client
      .db('Media')
      .collection('TV')
      .updateOne(
        { title: showData.title },
        { 
          $set: {
            'seasons.$[elem].metadata': updatedSeasonData
          }
        },
        { arrayFilters: [{ 'elem.seasonNumber': seasonNumber }] }
      )
  }
}

/**
 * Processes caption updates for a movie
 */
export async function processMovieCaptions(client, movie, fileServerData, serverConfig) {
  if (!fileServerData?.urls) {
    throw new Error(`No data found for movie ${movie.title} on server ${serverConfig.id}`)
  }

  if (!fileServerData.urls.subtitles) return null

  const updatedCaptions = processCaptionURLs(fileServerData.urls.subtitles, serverConfig)
  if (!updatedCaptions) return null

  const hasChanges = !isEqual(movie.captionURLs, updatedCaptions)
  if (hasChanges) {
    console.log(`Movie: Updating captions for ${movie.title} from server ${serverConfig.id}`)
    await updateMediaInDatabase(
      client, 
      MediaType.MOVIE, 
      movie.title,
      {
        captionURLs: updatedCaptions,
        captionSource: serverConfig.id
      },
      serverConfig.id
    )
    return true
  }
  return false
}

/**
 * Processes episode captions
 */
async function processEpisodeCaptions(
  episode,
  fileServerEpisodeData,
  showTitle,
  seasonNumber,
  serverConfig
) {
  if (!fileServerEpisodeData.subtitles) return null

  const updatedCaptions = processCaptionURLs(fileServerEpisodeData.subtitles, serverConfig)
  if (!updatedCaptions) return null

  const hasChanges = !isEqual(episode.captionURLs, updatedCaptions)
  if (!hasChanges) return null

  // Log added subtitles for this update
  const addedSubtitles = Object.entries(updatedCaptions)
    .filter(([langName]) => !episode.captionURLs?.[langName])
    .map(([langName, subtitleData]) => `${langName} (${subtitleData.srcLang})`)
    .join(', ')

  if (addedSubtitles) {
    console.log(
      `TV: Updating captions for ${showTitle} - Season ${seasonNumber}, Episode ${episode.episodeNumber}`,
      `Added subtitles: ${addedSubtitles} from server ${serverConfig.id}`
    )
  }

  return {
    captionURLs: updatedCaptions,
    captionSource: serverConfig.id
  }
}

/**
 * Processes season captions
 */
export async function processSeasonCaptions(client, show, season, fileServerShowData, serverConfig) {
  const fileServerSeasonData = fileServerShowData.seasons[`Season ${season.seasonNumber}`]
  if (!fileServerSeasonData?.urls) {
    throw new Error(
      `No data/captions found for ${show.title} - Season ${season.seasonNumber} on server ${serverConfig.id}`
    )
  }

  const updates = []
  for (const episode of season.episodes) {
    const episodeFileName = findEpisodeFileName(
      Object.keys(fileServerSeasonData.urls),
      season.seasonNumber,
      episode.episodeNumber
    )

    if (!episodeFileName) continue

    const fileServerEpisodeData = fileServerSeasonData.urls[episodeFileName]
    const updatedCaptions = await processEpisodeCaptions(
      episode,
      fileServerEpisodeData,
      show.title,
      season.seasonNumber,
      serverConfig
    )

    if (updatedCaptions) {
      updates.push({
        episodeNumber: episode.episodeNumber,
        updates: updatedCaptions
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
export async function processMovieChapters(client, movie, fileServerData, serverConfig) {
  const fileServerUrls = fileServerData?.urls || {}

  if (fileServerUrls.chapters) {
    const newChapterUrl = createFullUrl(fileServerUrls.chapters, serverConfig)

    if (movie.chapterURL !== newChapterUrl) {
      console.log(`Movie: Updating chapters for ${movie.title} from server ${serverConfig.id}`)
      await updateMediaInDatabase(
        client, 
        MediaType.MOVIE, 
        movie.title,
        {
          chapterURL: newChapterUrl,
          chapterSource: serverConfig.id
        },
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
            chapterSource: '' 
          }
        }
      )
    return true
  }
  return false
}

/**
 * Processes chapter updates for a TV episode
 */
async function processEpisodeChapters(client, episode, fileServerEpisodeData, showTitle, seasonNumber, serverConfig) {
  if (fileServerEpisodeData?.chapters) {
    const newChapterUrl = createFullUrl(fileServerEpisodeData.chapters, serverConfig)

    if (
      episode.chapterURL !== newChapterUrl ||
      episode.chapterURL === undefined ||
      episode.chapterURL === null
    ) {
      console.log(
        `TV: Updating chapters for ${showTitle} - Season ${seasonNumber}, Episode ${episode.episodeNumber} from server ${serverConfig.id}`
      )
      return {
        chapterURL: newChapterUrl,
        chapterSource: serverConfig.id
      }
    }
  } else if (episode.chapterURL && isSourceMatchingServer(episode, 'chapterSource', serverConfig)) {
    console.log(
      `TV: Removing chapters for ${showTitle} - Season ${seasonNumber}, Episode ${episode.episodeNumber} from server ${serverConfig.id}`
    )
    return {
      $unset: {
        chapterURL: '',
        chapterSource: ''
      }
    }
  }
  return null
}

/**
 * Processes chapter updates for a TV season
 */
export async function processSeasonChapters(client, show, season, fileServerShowData, serverConfig) {
  const fileServerSeasonData = fileServerShowData.seasons[`Season ${season.seasonNumber}`] || {
    urls: {}
  }

  const updates = []
  for (const episode of season.episodes) {
    const episodeFileName = findEpisodeFileName(
      Object.keys(fileServerSeasonData.urls),
      season.seasonNumber,
      episode.episodeNumber
    )

    const fileServerEpisodeData = episodeFileName
      ? fileServerSeasonData.urls[episodeFileName]
      : null

    const chapterUpdates = await processEpisodeChapters(
      client,
      episode,
      fileServerEpisodeData,
      show.title,
      season.seasonNumber,
      serverConfig
    )

    if (chapterUpdates) {
      updates.push({
        episodeNumber: episode.episodeNumber,
        updates: chapterUpdates
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

  return updates.length
}

/**
 * Processes the video URL update for a movie.
 * @param {Object} client - The database client.
 * @param {Object} movie - The movie object.
 * @param {Object} fileServerData - The data from the file server for the movie.
 * @param {Object} serverConfig - The configuration for the file server.
 * @returns {Promise<boolean|null>} - A Promise that resolves to true if the video URL was updated, null if the update was skipped.
 */
export async function processMovieVideoURL(client, movie, fileServerData, serverConfig) {
  if (!fileServerData) {
    throw new Error(`Movie "${movie.title}" not found on server ${serverConfig.id}`)
  }

  if (!fileServerData.urls?.mp4) {
    throw new Error(`No MP4 video URL found for movie "${movie.title}" on server ${serverConfig.id}`)
  }

  const newVideoURL = createFullUrl(fileServerData.urls.mp4, serverConfig)
  if (newVideoURL === movie.videoURL) return null

  // Only update if the current source is the same server or not set
  if (movie.videoSource && isSourceMatchingServer(movie, 'videoSource', serverConfig)) {
    console.log(
      `Skipping video URL update for "${movie.title}" - content owned by server ${movie.videoSource}`
    )
    return null
  }

  const updateData = { 
    videoURL: newVideoURL,
    videoSource: serverConfig.id
  }
  const filteredUpdateData = filterLockedFields(movie, updateData)

  if (!filteredUpdateData.videoURL) {
    console.log(`Field "videoURL" is locked for movie "${movie.title}". Skipping video URL update.`)
    return null
  }

  console.log(`Movie: Updating video URL for "${movie.title}" from server ${serverConfig.id}`)
  await updateMediaInDatabase(client, MediaType.MOVIE, movie.title, filteredUpdateData, serverConfig.id)
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
  client,
  episode,
  fileServerEpisodeData,
  showTitle,
  seasonNumber,
  serverConfig
) {
  if (!fileServerEpisodeData?.videourl) return null

  // Only update if the current source is not the same server or not set
  if (episode.videoSource && isSourceMatchingServer(episode, 'videoSource', serverConfig)) {
    return null
  }

  const newVideoURL = createFullUrl(fileServerEpisodeData.videourl, serverConfig)
  if (episode.videoURL === newVideoURL) return null
  
  console.log(
    `TV: Updating video URL for "${showTitle}" - Season ${seasonNumber}, Episode ${episode.episodeNumber} from server ${serverConfig.id}`
  )

  return {
    videoURL: newVideoURL,
    videoSource: serverConfig.id
  }
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
export async function processSeasonVideoURLs(client, show, season, fileServerShowData, serverConfig) {
  const fileServerSeasonData = fileServerShowData.seasons[`Season ${season.seasonNumber}`]
  if (!fileServerSeasonData) {
    throw new Error(
      `Season ${season.seasonNumber} for TV show "${show.title}" not found on server ${serverConfig.id}`
    )
  }

  const updates = []
  for (const episode of season.episodes) {
    const episodeFileName = findEpisodeFileName(
      Object.keys(fileServerSeasonData.urls),
      season.seasonNumber,
      episode.episodeNumber
    )

    if (!episodeFileName) continue

    const fileServerEpisodeData = fileServerSeasonData.urls[episodeFileName]
    const videoUpdates = await processEpisodeVideoURL(
      client,
      episode,
      fileServerEpisodeData,
      show.title,
      season.seasonNumber,
      serverConfig
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
 * Processes the logo URL update for a TV show.
 * @param {Object} client - The database client.
 * @param {Object} show - The TV show object.
 * @param {Object} fileServerData - The file server data for the TV show.
 * @param {Object} serverConfig - The server configuration.
 * @returns {Promise<boolean|null>} - A Promise that resolves to true if the logo URL was updated, null if no update was needed.
 */
export async function processShowLogo(client, show, fileServerData, serverConfig) {
  if (!fileServerData?.logo) return null

  const newLogoUrl = createFullUrl(fileServerData.logo, serverConfig)
  
  // Only update if the current source is the same server or not set
  if (show.logoSource && isSourceMatchingServer(show, 'logoSource', serverConfig)) {
    return null
  }

  if (show.logo === newLogoUrl) return null

  console.log(`TV: Updating logo URL for ${show.title} from server ${serverConfig.id}`)
  await updateMediaInDatabase(
    client,
    MediaType.TV,
    show.title,
    {
      logo: newLogoUrl,
      logoSource: serverConfig.id
    },
    serverConfig.id
  )
  return true
}

/**
 * Processes the logo URL update for a movie.
 * @param {Object} client - The database client.
 * @param {Object} movie - The movie object.
 * @param {Object} fileServerData - The file server data for the movie.
 * @param {Object} serverConfig - The server configuration.
 * @returns {Promise<boolean|null>} - A Promise that resolves to true if the logo URL was updated, null if no update was needed.
 */
export async function processMovieLogo(client, movie, fileServerData, serverConfig) {
  if (!fileServerData?.urls?.logo) return null

  const newLogoUrl = createFullUrl(fileServerData.urls.logo, serverConfig)
  
  // Only update if the current source is the same server or not set
  if (movie.logoSource && isSourceMatchingServer(movie, 'logoSource', serverConfig)) {
    return null
  }

  if (movie.logo === newLogoUrl) return null

  console.log(`Movie: Updating logo URL for ${movie.title} from server ${serverConfig.id}`)
  await updateMediaInDatabase(
    client,
    MediaType.MOVIE,
    movie.title,
    {
      logo: newLogoUrl,
      logoSource: serverConfig.id
    },
    serverConfig.id
  )
  return true
}

/**
 * Processes the blurhash update for a TV season.
 * @param {Object} season - The TV season object
 * @param {Object} fileServerSeasonData - The file server data for the TV season
 * @param {string} showTitle - The title of the TV show
 * @param {Object} serverConfig - Server configuration
 * @returns {Object} The updated TV season object or null if no updates needed
 */
export function processSeasonBlurhash(season, fileServerSeasonData, showTitle, serverConfig) {
  if (!fileServerSeasonData) return null

  // Only update if the current source is the same server or not set
  if (season.blurhashSource && isSourceMatchingServer(season, 'blurhashSource', serverConfig)) {
    return null
  }

  let needsUpdate = false
  let updatedSeason = { ...season }

  if (fileServerSeasonData.seasonPosterBlurhash) {
    const newBlurhashUrl = createFullUrl(fileServerSeasonData.seasonPosterBlurhash, serverConfig)
    
    if (!season.seasonPosterBlurhash || season.seasonPosterBlurhash !== newBlurhashUrl) {
      console.log(
        `TV Season: Updating seasonPosterBlurhash for ${showTitle} Season ${season.seasonNumber} from server ${serverConfig.id}`
      )
      updatedSeason = {
        ...updatedSeason,
        seasonPosterBlurhash: newBlurhashUrl,
        blurhashSource: serverConfig.id
      }
      needsUpdate = true
    }
  } else if (
    season.seasonPosterBlurhash && 
    isSourceMatchingServer(season, 'blurhashSource', serverConfig)
  ) {
    console.log(
      `TV Season: Removing seasonPosterBlurhash for ${showTitle} Season ${season.seasonNumber} from server ${serverConfig.id}`
    )
    const { 
      seasonPosterBlurhash, 
      blurhashSource, 
      ...seasonWithoutBlurhash 
    } = updatedSeason
    updatedSeason = seasonWithoutBlurhash
    needsUpdate = true
  }

  return needsUpdate ? updatedSeason : null
}

/**
 * Processes the blurhash update for a TV show.
 *
 * This function compares the TV show data with the file server data and updates the poster and backdrop blurhash fields in the database if needed.
 *
 * @param {Object} client - The MongoDB client instance.
 * @param {Object} show - The TV show object containing the current blurhash data.
 * @param {Object} fileServerData - The file server data containing the updated blurhash URLs.
 * @param {Object} serverConfig - The server configuration object.
 * @returns {Promise<boolean|null>} - True if the show was updated, null if no updates were needed.
 */
export async function processShowBlurhash(client, show, fileServerData, serverConfig) {
  if (!fileServerData) return null

  const updates = {}
  const unsetFields = {}

  const blurhashURL = createFullUrl(fileServerData.posterBlurhash, serverConfig)

  // Process poster blurhash
  if (fileServerData.posterBlurhash && 
      (blurhashURL !== show.posterBlurhash) || (!show.posterBlurhash || !isSourceMatchingServer(show, 'blurhashSource', serverConfig))) {
    updates.posterBlurhash = blurhashURL
    updates.blurhashSource = serverConfig.id
  } else if (!fileServerData.posterBlurhash && 
             show.posterBlurhash && 
             isSourceMatchingServer(show, 'blurhashSource', serverConfig)) {
    unsetFields.posterBlurhash = ''
    unsetFields.blurhashSource = ''
  }

  // Process backdrop blurhash (similar logic)
  if (fileServerData.backdropBlurhash &&
      (!show.backdropBlurhash || !isSourceMatchingServer(show, 'backdropBlurhashSource', serverConfig))) {
    updates.backdropBlurhash = createFullUrl(fileServerData.backdropBlurhash, serverConfig)
    updates.backdropBlurhashSource = serverConfig.id
  } else if (!fileServerData.backdropBlurhash &&
             show.backdropBlurhash &&
             isSourceMatchingServer(show, 'backdropBlurhashSource', serverConfig)) {
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

    await client
      .db('Media')
      .collection('TV')
      .updateOne(
        { title: show.title },
        updateOperation
      )

    await updateMediaUpdates(show.title, MediaType.TV)
    return true
  }

  return null
}

/**
 * Processes the blurhash for a movie poster.
 *
 * This function compares the movie's current blurhash with the blurhash data from the file server. If the blurhash has changed, it updates the movie's blurhash and blurhash source in the database.
 *
 * @param {Object} client - The database client.
 * @param {Object} movie - The movie object containing the current blurhash information.
 * @param {Object} fileServerData - The file server data containing the updated blurhash information.
 * @param {Object} serverConfig - The configuration for the current file server.
 * @returns {Promise<boolean|null>} - True if the movie's blurhash was updated, null if no update was needed.
 */
export async function processMovieBlurhash(client, movie, fileServerData, serverConfig) {
  if (!fileServerData?.urls?.posterBlurhash) return null

  // Only update if the current source is the same server or not set
  if (movie.blurhashSource && isSourceMatchingServer(movie, 'blurhashSource', serverConfig)) {
    return null
  }

  const newBlurhash = createFullUrl(fileServerData.urls.posterBlurhash, serverConfig)
  if (movie.posterBlurhash === newBlurhash && isSourceMatchingServer(movie, 'blurhashSource', serverConfig)) return null

  console.log(`Movie: Updating posterBlurhash for ${movie.title} from server ${serverConfig.id}`)
  await updateMediaInDatabase(
    client,
    MediaType.MOVIE,
    movie.title,
    {
      posterBlurhash: newBlurhash,
      blurhashSource: serverConfig.id
    },
    serverConfig.id
  )
  return true
}

/**
 * Processes video information updates for an episode.
 *
 * This function compares the episode's current video information with the updated information from the file server. If any changes are detected, it updates the episode's video information in the database.
 *
 * @param {Object} episode - The episode object containing the current video information.
 * @param {string} episodeFileName - The file name of the episode on the file server.
 * @param {Object} fileServerSeasonData - The file server data for the season containing the episode.
 * @param {Object} serverConfig - The configuration for the current file server.
 * @returns {Promise<Object|null>} - An object containing the updated video information, or null if no updates are needed.
 */
export async function processEpisodeVideoInfo(episode, episodeFileName, fileServerSeasonData, serverConfig) {
  const episodeInfo = fileServerSeasonData.urls[episodeFileName]?.additionalMetadata
  if (!episodeInfo) {
    console.warn(`No additionalMetadata found for ${episodeFileName} in server ${serverConfig.id} data.`)
    return null
  }

  // Only update if the current source is the same server or not set
  if (episode.videoInfoSource && isSourceMatchingServer(episode, 'videoInfoSource', serverConfig)) {
    return null
  }

  const updateData = {}
  const hdrInfo = fileServerSeasonData.urls[episodeFileName]?.hdr || null

  // Check each field for updates
  if (fileServerSeasonData.lengths[episodeFileName] &&
      episode.length !== fileServerSeasonData.lengths[episodeFileName]) {
    updateData.length = fileServerSeasonData.lengths[episodeFileName]
  }

  if (fileServerSeasonData.dimensions[episodeFileName] &&
      episode.dimensions !== fileServerSeasonData.dimensions[episodeFileName]) {
    updateData.dimensions = fileServerSeasonData.dimensions[episodeFileName]
  }

  if (hdrInfo && episode.hdr !== hdrInfo) {
    updateData.hdr = hdrInfo
  }

  if (episodeInfo.duration && episode.duration !== episodeInfo.duration * 1000) {
    updateData.duration = episodeInfo.duration * 1000
  }

  if (Object.keys(updateData).length > 0) {
    updateData.videoInfoSource = serverConfig.id
    return updateData
  }

  return null
}

/**
 * Processes video information updates for a season of a TV show.
 *
 * This function compares the episode video information in the database with the updated information from the file server. If any changes are detected, it updates the episode video information in the database.
 *
 * @param {Object} client - The database client.
 * @param {Object} show - The TV show object.
 * @param {Object} season - The season object.
 * @param {Object} fileServerShowData - The file server data for the TV show.
 * @param {Object} serverConfig - The configuration for the current file server.
 * @returns {Promise<number>} - The number of episodes that were updated.
 */
export async function processSeasonVideoInfo(client, show, season, fileServerShowData, serverConfig) {
  const seasonKey = `Season ${season.seasonNumber}`
  const fileServerSeasonData = fileServerShowData?.seasons[seasonKey]

  if (!fileServerSeasonData?.fileNames) {
    return 0
  }

  let updatedEpisodes = 0

  await Promise.all(
    season.episodes.map(async episode => {
      const episodeFileName = findEpisodeFileName(
        fileServerSeasonData.fileNames,
        season.seasonNumber,
        episode.episodeNumber
      )

      if (!episodeFileName) return

      try {
        const updates = await processEpisodeVideoInfo(
          episode,
          episodeFileName,
          fileServerSeasonData,
          serverConfig
        )

        if (updates) {
          console.log(
            `TV: Updating video info for ${show.title} - ${seasonKey}, Episode ${episode.episodeNumber} from server ${serverConfig.id}`
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
          `Error updating video info for ${show.title} S${season.seasonNumber}E${episode.episodeNumber} from server ${serverConfig.id}:`,
          error
        )
      }
    })
  )

  return updatedEpisodes
}

/**
 * Processes video information for a movie from a file server.
 * @param {Object} client - The database client to use for updates.
 * @param {Object} movie - The movie object containing current video information.
 * @param {Object} fileServerData - The video information data from the file server.
 * @param {Object} serverConfig - The configuration for the file server.
 * @returns {boolean|null} - True if the movie's video information was updated, null if no updates were needed.
 */
export async function processMovieVideoInfo(client, movie, fileServerData, serverConfig) {
  if (!fileServerData?.fileNames) {
    return null
    //throw new Error(`No file server data found for movie: ${movie.title} on server ${serverConfig.id}`)
  }

  // Only update if the current source is the same server or not set
  if (movie.videoInfoSource && isSourceMatchingServer(movie, 'videoInfoSource', serverConfig)) {
    return null
  }

  const mp4File = fileServerData.fileNames.find(name => name.endsWith('.mp4'))
  if (!mp4File) return null

  const updateData = {}

  // Check each field for updates
  if (fileServerData.length[mp4File] && movie.length !== fileServerData.length[mp4File]) {
    updateData.length = fileServerData.length[mp4File]
  }

  if (fileServerData.dimensions[mp4File] && movie.dimensions !== fileServerData.dimensions[mp4File]) {
    updateData.dimensions = fileServerData.dimensions[mp4File]
  }

  if (fileServerData.hdr && movie.hdr !== fileServerData.hdr) {
    updateData.hdr = fileServerData.hdr
  }

  // if (fileServerData.duration && movie.duration !== fileServerData.duration * 1000) {
  //   updateData.duration = fileServerData.duration * 1000
  // }

  if (fileServerData.size && movie.size !== fileServerData.size) {
    updateData.size = fileServerData.size
  }

  if (!movie.videoInfoSource) {
    updateData.videoInfoSource = serverConfig.id
  }

  if (Object.keys(updateData).length > 0) {
    console.log(`Movie: Updating video info for ${movie.title} from server ${serverConfig.id}`)
    await updateMediaInDatabase(
      client,
      MediaType.MOVIE,
      movie.title,
      updateData,
      serverConfig.id
    )
    return true
  }

  return null
}

/**
 * Processes season thumbnails for a TV show.
 * @param {Object} client - The database client
 * @param {Object} show - The TV show object
 * @param {Object} season - The season object
 * @param {Object} fileServerShowData - The file server data for the TV show
 * @param {Object} serverConfig - The server configuration
 * @returns {number} The number of updated episodes
 */
export async function processSeasonThumbnails(client, show, season, fileServerShowData, serverConfig) {
  const fileServerSeasonData = fileServerShowData.seasons[`Season ${season.seasonNumber}`]
  if (!fileServerSeasonData?.urls) return 0

  let updatedEpisodes = 0

  for (const episode of season.episodes) {
    const episodeFileName = findEpisodeFileName(
      Object.keys(fileServerSeasonData.urls),
      season.seasonNumber,
      episode.episodeNumber
    )

    if (!episodeFileName) continue

    // Only update if the current source is the same server or not set
    if (episode.thumbnailSource && isSourceMatchingServer(episode, 'thumbnailSource', serverConfig)) {
      continue
    }

    const fileServerEpisodeData = fileServerSeasonData.urls[episodeFileName]
    const updates = processEpisodeThumbnails(episode, fileServerEpisodeData, serverConfig)

    if (updates) {
      console.log(
        `TV: Updating thumbnails for ${show.title} - Season ${season.seasonNumber}, Episode ${episode.episodeNumber} from server ${serverConfig.id}`
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
  }

  return updatedEpisodes
}

/**
 * Processes episode thumbnails and blurhash URLs from file server data.
 * @param {Object} episode - The episode object
 * @param {Object} fileServerEpisodeData - The file server data for the episode
 * @param {Object} serverConfig - The server configuration
 * @returns {Object|null} An object containing the updated thumbnail and blurhash URLs if changes were needed, null otherwise
 */
function processEpisodeThumbnails(episode, fileServerEpisodeData, serverConfig) {
  const updates = {}

  if (fileServerEpisodeData.thumbnail) {
    const newThumbnailUrl = createFullUrl(fileServerEpisodeData.thumbnail, serverConfig)
    if (!episode.thumbnail || episode.thumbnail !== newThumbnailUrl) {
      updates.thumbnail = newThumbnailUrl
    }
  }

  if (fileServerEpisodeData.thumbnailBlurhash) {
    const newBlurhashUrl = createFullUrl(fileServerEpisodeData.thumbnailBlurhash, serverConfig)
    if (!episode.thumbnailBlurhash || episode.thumbnailBlurhash !== newBlurhashUrl) {
      updates.thumbnailBlurhash = newBlurhashUrl
    }
  }

  if (updates.thumbnailBlurhash && !isSourceMatchingServer(episode, 'thumbnailSource', serverConfig)) {
    updates.thumbnailSource = serverConfig.id
  }

  return Object.keys(updates).length > 0 ? updates : null
}

/**
 * Processes show poster URL updates.
 * @param {Object} show - The show object.
 * @param {Object} fileServerData - The file server data for the show.
 * @param {Object} serverConfig - The server configuration.
 * @returns {Object|null} An object containing the updated poster URL and source if changes were needed, null otherwise.
 */
export function processShowPosterURL(show, fileServerData, serverConfig) {
  if (!fileServerData.poster) return null

  // Only update if the current source is the same server or not set
  if (show.posterSource && isSourceMatchingServer(show, 'posterSource', serverConfig)) {
    return null
  }

  const newPosterURL = createFullUrl(fileServerData.poster, serverConfig)
  if (show.poster === newPosterURL) return null

  return {
    posterURL: newPosterURL,
    posterSource: serverConfig.id
  }
}

/**
 * Processes movie poster URL updates.
 * @param {Object} movie - The movie object.
 * @param {Object} fileServerData - The file server data for the movie.
 * @param {Object} serverConfig - The server configuration.
 * @returns {Object|null} An object containing the updated poster URL and source if changes were needed, null otherwise.
 */
export function processMoviePosterURL(movie, fileServerData, serverConfig) {
  if (!fileServerData.urls?.posterURL) return null

  // Only update if the current source is the same server or not set
  if (movie.posterSource && isSourceMatchingServer(movie, 'posterSource', serverConfig)) {
    return null
  }

  const newPosterURL = createFullUrl(fileServerData.urls.posterURL, serverConfig)
  if (movie.posterURL === newPosterURL) return null

  return {
    posterURL: newPosterURL,
    posterSource: serverConfig.id
  }
}

/**
 * Processes season poster updates for a list of seasons.
 * 
 * @param {Array<Season>} seasons - The list of seasons to process.
 * @param {Object} fileServerData - The data from the file server.
 * @param {Object} serverConfig - The configuration for the server.
 * @returns {Object} - An object containing the updated seasons and a flag indicating if any updates were made.
 */
export async function processSeasonPosters(seasons, fileServerData, serverConfig) {
  const updatedSeasons = []
  let hasUpdates = false

  for (const season of seasons) {
    const fileServerSeasonData = fileServerData.seasons[`Season ${season.seasonNumber}`]
    
    if (!fileServerSeasonData) {
      updatedSeasons.push(season)
      continue
    }

    let updatedSeason = { ...season }
    let seasonUpdated = false

    // Only update if the current source is the same server or not set
    if (!season.posterSource || !isSourceMatchingServer(season, 'posterSource', serverConfig)) {
      if (fileServerSeasonData.season_poster) {
        const newPosterURL = createFullUrl(fileServerSeasonData.season_poster, serverConfig)
        if (season.season_poster !== newPosterURL) {
          updatedSeason = {
            ...updatedSeason,
            season_poster: newPosterURL,
            posterSource: serverConfig.id
          }
          seasonUpdated = true
        }
      }
    }

    if (seasonUpdated) {
      hasUpdates = true
    }
    updatedSeasons.push(updatedSeason)
  }

  return { updatedSeasons, hasUpdates }
}

/**
 * Processes backdrop updates for media items
 */
export function processBackdropUpdates(media, fileServerData, serverConfig) {
  const updates = {}
  const fileServerUrls = fileServerData?.urls || fileServerData

  // Process main backdrop
  if (!media.backdropSource || !isSourceMatchingServer(media, 'backdropSource', serverConfig)) {
    if (fileServerUrls.backdrop) {
      const newBackdropUrl = createFullUrl(fileServerUrls.backdrop, serverConfig)
      if (!media.backdrop || media.backdrop !== newBackdropUrl || !isSourceMatchingServer(media, 'backdropSource', serverConfig)) {
        updates.backdrop = newBackdropUrl
        updates.backdropSource = serverConfig.id
      }
    }
  }

  // Process backdrop blurhash
  if (!media.backdropBlurhashSource || !isSourceMatchingServer(media, 'backdropBlurhashSource', serverConfig)) {
    if (fileServerUrls.backdropBlurhash) {
      const newBlurhashUrl = createFullUrl(fileServerUrls.backdropBlurhash, serverConfig)
      if (!media.backdropBlurhash || media.backdropBlurhash !== newBlurhashUrl || !isSourceMatchingServer(media, 'backdropBlurhashSource', serverConfig)) {
        updates.backdropBlurhash = newBlurhashUrl
        updates.backdropBlurhashSource = serverConfig.id
      }
    }
  }

  return Object.keys(updates).length > 0 ? updates : null
}

function shouldUpdateSeason(showMetadata, season) {
  return new Date(showMetadata.seasons?.last_updated) >
    new Date(season.metadata.episodes?.last_updated ?? '2024-01-01T01:00:00.000000')
}

/**
 * Checks if a media item's source matches a server configuration ID
 * @param {Object} item - The media item (movie, episode, etc.)
 * @param {string} sourceKey - The key to check (e.g., 'blurhashSource', 'videoInfoSource')
 * @param {Object} serverConfig - The server configuration object containing an ID
 * @param {string} serverConfig.id - The server configuration ID to check against
 * @returns {boolean} Returns true if the source matches the server config ID
 */
const isSourceMatchingServer = (item, sourceKey, serverConfig) => {
  if (!item || !sourceKey || !serverConfig?.id) {
    return false;
  }

  return item[sourceKey] && item[sourceKey] === serverConfig.id;
}
