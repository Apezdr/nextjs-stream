import axios from 'axios'
import { buildURL, getFullImageUrl } from '@src/utils'
import { fileServerURLWithoutPrefixPath } from '@src/utils/config'
import { getLastUpdatedTimestamp } from '@src/utils/database'

export function processMediaData(jsonResponseString) {
  const { movies, tv } = jsonResponseString

  // Prepare headers for the tables
  const movieHeaders = ['Poster', 'Title', 'Genre', 'Year']
  const tvHeaders = ['Poster', 'Title', 'Seasons', 'Year']

  let result = {}

  // Process movies if present
  if (movies && movies.length > 0) {
    const movieData = movies.map((movie) => {
      let poster =
        movie.posterURL ||
        getFullImageUrl(movie.metadata?.poster_path) ||
        buildURL(`/sorry-image-not-available.jpg`)

      return {
        id: movie._id.toString(),
        posterURL: poster,
        title:
          movie.title === movie.metadata?.title
            ? movie.metadata?.title
            : movie.title + ` (${movie.metadata?.title})` || movie.title,
        genre: movie.metadata?.genres.map((genre) => genre.name).join(', '),
        year: movie.metadata?.release_date ? movie.metadata.release_date.getFullYear() : 'N/A',
      }
    })

    result.movies = {
      headers: movieHeaders,
      data: movieData,
    }
  }

  // Process TV shows if present
  if (tv && tv.length > 0) {
    const tvData = tv.map((show) => {
      let poster = show.posterURL || getFullImageUrl(show.metadata?.poster_path, 'w185')
      if (!poster) {
        poster = null
      }
      const startYear = getYearFromDate(show.metadata?.first_air_date)
      const endYear = getYearFromDate(show.metadata?.last_air_date)

      let released
      if (startYear && endYear && startYear !== endYear) {
        released = `${startYear}–${endYear}`
      } else {
        released = startYear ? startYear.toString() : ''
      }

      if (!released) {
        released = show.metadata?.release_date.getFullYear()
      }
      return {
        id: show._id.toString(),
        posterURL: poster,
        title: show.title,
        seasons: show.seasons.length,
        year: released,
      }
    })

    result.tvShows = {
      headers: tvHeaders,
      data: tvData,
    }
  }

  return result
}

export function processUserData(jsonResponse) {
  // Assuming jsonResponse is an array of user records
  const users = jsonResponse

  // Prepare headers for the user table
  const userHeaders = ['Name', 'Email', 'Image', 'Limited Access', 'Approved', 'Actions']

  // Transform data for users
  const userData = users.map((user) => ({
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    imageUrl: user.image, // Add image URL
    limitedAccess: user.limitedAccess ? true : false, // If the user is approved to view content
    approved: user.approved.toString(), // If the user is approved to view content
  }))

  return {
    headers: userHeaders,
    data: userData,
  }
}

// Regular expression to extract episode number and title
/**
 * Regular expression to extract episode number and title from a filename.
 * Matches filenames in the format:
 * - S01E02 - Episode Title.ext
 * - 02 - Episode Title.ext
 * And captures:
 * - Episode number in capture group 1 or 2
 * - Episode title in capture group 3
 */
const patterns = [
  /S(\d+)E(\d+)(?:\s*-\s*(.+?))?(?:\s*-\s*.+?)?\.([^.]+)$/i, // Matches 'S01E01 - Title - Extra.mp4'
  /(\d+)(?:\s*-\s*(.+?))?\.([^.]+)$/i, // Matches '01 - Title.mp4'
  /(.+?)\s*-\s*S(\d+)E(\d+)(?:\s*-\s*(.+?))?(?:\s*-\s*.+?)?\.([^.]+)$/i, // Matches '1923 - S01E01 - Title - Extra.mp4'
]

export function matchEpisodeFileName(filename) {
  for (const pattern of patterns) {
    const match = filename.match(pattern)
    if (match) {
      return match
    }
  }
  return null
}

export function extractEpisodeDetails(match) {
  if (!match) return null

  // Determine which pattern matched and extract details accordingly
  if (match.length === 5 && match[1] && match[2]) {
    // Pattern 1: SxxExx
    return {
      seasonNumber: parseInt(match[1]),
      episodeNumber: parseInt(match[2]),
      title: match[3].replace(/(WEBRip|WEBDL|HDTV|Bluray|\d{3,4}p).*$/i, '').trim() || '',
      extension: match[4],
    }
  } else if (match.length === 4 && match[1] && match[2]) {
    // Pattern 2: xx - Title
    return {
      seasonNumber: null,
      episodeNumber: parseInt(match[1]),
      title: match[2].replace(/(WEBRip|WEBDL|HDTV|Bluray|\d{3,4}p).*$/i, '').trim() || '',
      extension: match[3],
    }
  } else if (match.length === 6 && match[2] && match[3]) {
    // Pattern 3: Title - SxxExx - Title - Extra
    return {
      seasonNumber: parseInt(match[2]),
      episodeNumber: parseInt(match[3]),
      title: match[4].replace(/(WEBRip|WEBDL|HDTV|Bluray|\d{3,4}p).*$/i, '').trim() || '',
      extension: match[5],
    }
  }

  return null
}

function getYearFromDate(dateString) {
  return dateString ? new Date(dateString).getFullYear() : null
}

// Utilities for syncing media
function extractSeasonInfo(seasonInfo, showTitle, fileServer) {
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
        seasonPosterBlurhash: fileServer?.tv[showTitle].seasons[seasonInfo].seasonPosterBlurhash,
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
        seasonPosterBlurhash:
          fileServer?.tv[showTitle].seasons[seasonIdentifier].seasonPosterBlurhash,
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

export async function addOrUpdateSeason(
  currentShow,
  seasonInfo,
  showTitle,
  fileServer,
  showMetadata
) {
  const { number, seasonIdentifier, season_poster, seasonPosterBlurhash, episodes } =
    extractSeasonInfo(seasonInfo, showTitle, fileServer)
  if (episodes.length > 0 && episodes !== undefined && episodes !== null) {
    let currentSeasonIndex = currentShow.seasons.findIndex((s) => s.seasonNumber === number)

    // If the season doesn't exist, initialize it
    if (currentSeasonIndex === -1) {
      currentShow.seasons.push({ seasonNumber: number, episodes: [] })
      currentSeasonIndex = currentShow.seasons.length - 1
    }

    let seasonMetadata = showMetadata.seasons.find((s) => s.season_number === number) || {
      episode_count: 0,
    }

    for (const episode of episodes) {
      const episodeMatch = matchEpisodeFileName(episode.fileName)
      if (episodeMatch) {
        const { episodeNumber, title } = extractEpisodeDetails(episodeMatch)

        let episodeMetadata = {}
        /**
         * Adds the episode metadata to the season metadata object.
         * Episode metadata is used in the frontend from this new
         * episodes array inside seasons.
         */
        if (episode.metadata) {
          try {
            episodeMetadata = await fetchMetadata(episode.metadata)
            seasonMetadata.episodes = seasonMetadata.episodes || []
            seasonMetadata.episodes.push(episodeMetadata) // Append episode metadata
          } catch (error) {
            console.error('Error fetching episode metadata:', error)
          }
        }

        // If we wanted to use the metadata title, we could set the title here instead
        // title = episodeMetadata.name || name
        const existingEpisodeIndex = currentShow.seasons[currentSeasonIndex].episodes.findIndex(
          (e) => e.episodeNumber === episodeNumber
        )
        if (existingEpisodeIndex === -1) {
          const videoURL =
            fileServer?.tv[showTitle].seasons[seasonIdentifier].urls[episode.fileName].videourl
          // Store the thumbnail blurhash URL
          let thumbnailBlurhash = episode.thumbnailBlurhash ?? false
          let captions =
            fileServer?.tv[showTitle].seasons[seasonIdentifier].urls[episode.fileName].subtitles

          let updatedData = {
            episodeNumber: episodeNumber,
            title,
            videoURL: fileServerURLWithoutPrefixPath + `${videoURL}`,
            mediaLastModified: episode.mediaLastModified,
            length: episode.length,
            dimensions: episode.dimensions,
          }
          if (episode.thumbnail) {
            updatedData.thumbnail = fileServerURLWithoutPrefixPath + `${episode.thumbnail}`
          }
          if (episode.thumbnailBlurhash) {
            updatedData.thumbnailBlurhash = fileServerURLWithoutPrefixPath + `${thumbnailBlurhash}`
          }

          /**
           * Updates the URLs for captions files to point to the file server.
           * Loops through the captions object, updating each URL to prepend
           * the file server URL. Adds the updated captions to the episode
           * metadata.
           */
          if (captions) {
            Object.keys(captions).map((caption) => {
              captions[caption].url = fileServerURLWithoutPrefixPath + `${captions[caption].url}`
              return caption
            })
            updatedData.captionURLs = captions
          }

          // Add chapterURL if chapters file exists
          if (fileServer?.tv[showTitle].seasons[seasonIdentifier].urls[episode.fileName].chapters) {
            updatedData.chapterURL =
              fileServerURLWithoutPrefixPath +
              `${
                fileServer?.tv[showTitle].seasons[seasonIdentifier].urls[episode.fileName].chapters
              }`
          }

          currentShow.seasons[currentSeasonIndex].episodes.push(updatedData)
        }
      }
    }

    currentShow.seasons[currentSeasonIndex].episodes.sort(
      (a, b) => a.episodeNumber - b.episodeNumber
    )
    currentShow.seasons[currentSeasonIndex].metadata = seasonMetadata
    currentShow.seasons[currentSeasonIndex].season_poster =
      fileServerURLWithoutPrefixPath + `${season_poster}`
    currentShow.seasons[currentSeasonIndex].seasonPosterBlurhash =
      fileServerURLWithoutPrefixPath + `${seasonPosterBlurhash}`
  }
}

const metadataCache = new Map()

// Function to fetch
export async function fetchMetadata(metadataUrl, type = 'file', mediaType, title) {
  if (metadataUrl === undefined) {
    return {}
  }
  try {
    const cacheKey = `${type}:${metadataUrl}`
    const lastUpdated = await getLastUpdatedTimestamp({ type: mediaType, title })

    if (metadataCache.has(cacheKey)) {
      const cachedData = metadataCache.get(cacheKey)
      if (cachedData.lastUpdated === lastUpdated) {
        return cachedData.data
      }
    }

    if (metadataUrl.startsWith(fileServerURLWithoutPrefixPath)) {
      metadataUrl = metadataUrl.replace(fileServerURLWithoutPrefixPath, '')
    }
    // Remove leading slash
    if (metadataUrl.startsWith('/')) {
      metadataUrl = metadataUrl.slice(1)
    }

    const response = await axios.get(fileServerURLWithoutPrefixPath + `/${metadataUrl}`)
    const data = type === 'blurhash' ? response.data.trim() : response.data

    metadataCache.set(cacheKey, { data, lastUpdated })
    return data
  } catch (error) {
    console.log(
      'Error fetching metadata:',
      fileServerURLWithoutPrefixPath + `/${metadataUrl}`,
      error
    )
    return false
  }
}
// End of utilities for syncing media
