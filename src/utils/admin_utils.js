import axios from 'axios'
import { getFullImageUrl } from '.'
import { fileServerURL } from './config'

export function processMediaData(jsonResponseString) {
  const { movies, tv } = jsonResponseString

  // Prepare headers for the tables
  const movieHeaders = ['Poster', 'Title', 'Genre', 'Year']
  const tvHeaders = ['Poster', 'Title', 'Seasons', 'Year']

  // Transform data for movies
  const movieData = movies.map((movie) => {
    let poster = movie.posterURL || getFullImageUrl(movie.metadata?.poster_path)
    if (!poster) {
      poster = null
    }
    return {
      id: movie._id.toString(),
      posterURL: poster, // Add poster URL
      title:
        movie.title === movie.metadata?.title
          ? movie.metadata?.title
          : movie.title + ` (${movie.metadata?.title})` || movie.title,
      genre: movie.metadata?.genres.map((genre) => genre.name).join(', '),
      year: movie.metadata?.release_date ? movie.metadata.release_date.getFullYear() : 'N/A',
    }
  })

  // Transform data for TV shows
  const tvData = tv.map((show) => {
    let poster = show.posterURL || getFullImageUrl(show.metadata?.poster_path, 'w185')
    if (!poster) {
      poster = null
    }
    // Extract years
    const startYear = getYearFromDate(show.metadata?.first_air_date)
    const endYear = getYearFromDate(show.metadata?.last_air_date)

    // Format release range
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
      posterURL: poster, // Add poster URL
      title: show.title,
      seasons: show.seasons.length,
      year: released,
    }
  })

  return {
    movies: {
      headers: movieHeaders,
      data: movieData,
    },
    tvShows: {
      headers: tvHeaders,
      data: tvData,
    },
  }
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
        season_poster: fileServer.tv[showTitle].seasons[seasonInfo].season_poster,
        seasonPosterBlurhash: fileServer.tv[showTitle].seasons[seasonInfo].seasonPosterBlurhash,
        episodes: fileServer.tv[showTitle].seasons[seasonInfo].fileNames.map(function (fileName) {
          let returnData = {
            fileName,
            videoURL: fileServer.tv[showTitle].seasons[seasonInfo].urls[fileName].videourl,
            length: fileServer.tv[showTitle].seasons[seasonInfo].lengths[fileName],
            dimensions: fileServer.tv[showTitle].seasons[seasonInfo].dimensions[fileName],
            mediaLastModified: new Date(
              fileServer.tv[showTitle].seasons[seasonInfo].urls[fileName].mediaLastModified
            ),
          }
          if (fileServer.tv[showTitle].seasons[seasonInfo].urls[fileName].thumbnail) {
            returnData.thumbnail =
              fileServer.tv[showTitle].seasons[seasonInfo].urls[fileName].thumbnail
          }
          if (fileServer.tv[showTitle].seasons[seasonInfo].urls[fileName].thumbnailBlurhash) {
            returnData.thumbnailBlurhash =
              fileServer.tv[showTitle].seasons[seasonInfo].urls[fileName].thumbnailBlurhash
          }
          if (fileServer.tv[showTitle].seasons[seasonInfo].urls[fileName].metadata) {
            returnData.metadata =
              fileServer.tv[showTitle].seasons[seasonInfo].urls[fileName].metadata
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
        season_poster: fileServer.tv[showTitle].seasons[seasonIdentifier].season_poster,
        seasonPosterBlurhash:
          fileServer.tv[showTitle].seasons[seasonIdentifier].seasonPosterBlurhash,
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
            fileServer.tv[showTitle].seasons[seasonIdentifier].urls[episode.fileName].videourl
          // Store the thumbnail blurhash URL
          let thumbnailBlurhash = episode.thumbnailBlurhash ?? false
          let captions =
            fileServer.tv[showTitle].seasons[seasonIdentifier].urls[episode.fileName].subtitles

          let updatedData = {
            episodeNumber: episodeNumber,
            title,
            videoURL: fileServerURL + `${videoURL}`,
            mediaLastModified: episode.mediaLastModified,
            length: episode.length,
            dimensions: episode.dimensions,
          }
          if (episode.thumbnail) {
            updatedData.thumbnail = fileServerURL + `${episode.thumbnail}`
          }
          if (episode.thumbnailBlurhash) {
            updatedData.thumbnailBlurhash = fileServerURL + `${thumbnailBlurhash}`
          }

          /**
           * Updates the URLs for captions files to point to the file server.
           * Loops through the captions object, updating each URL to prepend
           * the file server URL. Adds the updated captions to the episode
           * metadata.
           */
          if (captions) {
            Object.keys(captions).map((caption) => {
              captions[caption].url = fileServerURL + `${captions[caption].url}`
              return caption
            })
            updatedData.captionURLs = captions
          }

          // Add chapterURL if chapters file exists
          if (fileServer.tv[showTitle].seasons[seasonIdentifier].urls[episode.fileName].chapters) {
            updatedData.chapterURL =
              fileServerURL +
              `${
                fileServer.tv[showTitle].seasons[seasonIdentifier].urls[episode.fileName].chapters
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
    currentShow.seasons[currentSeasonIndex].season_poster = fileServerURL + `${season_poster}`
    currentShow.seasons[currentSeasonIndex].seasonPosterBlurhash =
      fileServerURL + `${seasonPosterBlurhash}`
  }
}

// Function to fetch
export async function fetchMetadata(metadataUrl, type = 'file') {
  try {
    if (metadataUrl.startsWith(fileServerURL)) {
      metadataUrl = metadataUrl.replace(fileServerURL, '')
    }
    // Remove leading slash
    if (metadataUrl.startsWith('/')) {
      metadataUrl = metadataUrl.slice(1)
    }
    const response = await axios.get(fileServerURL + `/${metadataUrl}`)
    if (type === 'blurhash') {
      let blurhash = response.data
      return blurhash.trim()
    }
    return response.data
  } catch (error) {
    console.log('Error fetching metadata:', fileServerURL + `/${metadataUrl}`, error)
    return false
  }
}
// End of utilities for syncing media

/**
 * Convert date to Eastern Standard Time and format it.
 * @param {string} dateStr - The date string in ISO format.
 * @returns {string} The formatted date in EST.
 */
function formatDateToEST(dateStr) {
  const options = {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }

  const date = new Date(dateStr)
  const formatter = new Intl.DateTimeFormat('en-US', options)
  const parts = formatter.formatToParts(date)
  const formattedDate = parts
    .map(({ type, value }) => {
      switch (type) {
        case 'day':
        case 'month':
        case 'year':
        case 'hour':
        case 'minute':
        case 'second':
          return value
        case 'dayPeriod':
          return ` ${value}`
        case 'literal':
          return type === 'literal' && value === ' ' ? ', ' : value
        default:
          return value
      }
    })
    .join('')

  return formattedDate
}

/**
 * Sanitize record to a consistent format
 * @param {Object} record - The media record
 * @param {string} type - The type of media (movie or TV)
 * @returns {Object} The sanitized record
 */
export async function sanitizeRecord(record, type, lastWatchedVideo) {
  try {
    let poster = record.posterURL || record.metadata?.poster_path
    if (!poster) {
      poster = null
    }
    if (record._id) {
      record._id = record._id.toString()
    }
    if (record.posterBlurhash) {
      record.posterBlurhash = await fetchMetadata(record.posterBlurhash, 'blurhash')
    }

    if (type === 'tv' && record.episode) {
      // Special handling for TV show episodes
      return {
        id: record._id.toString(),
        date: formatDateToEST(lastWatchedVideo.lastUpdated),
        link: `${record.showTitle}/${record.seasonNumber}/${record.episode.episodeNumber}`,
        length: record.length ?? 0,
        posterURL: poster,
        posterBlurhash: record.posterBlurhash || null,
        title: record.showTitleFormatted || null,
        logo: record.logo || null,
        type: type,
        metadata: record.metadata || null,
        seasons: record.seasons,
        media: {
          showTitle: record.showTitle,
          seasonNumber: record.seasonNumber,
          episode: {
            episodeNumber: record.episode.episodeNumber,
            title: record.episode.title,
            videoURL: record.episode.videoURL,
            mediaLastModified: record.episode.mediaLastModified,
            length: record.episode.length,
            dimensions: record.episode.dimensions,
            thumbnail: record.episode.thumbnail,
            thumbnailBlurhash: record.episode.thumbnailBlurhash,
            captionURLs: record.episode.captionURLs,
          },
        },
      }
    } else {
      // Default handling for movies
      return {
        id: record._id.toString(),
        date: formatDateToEST(lastWatchedVideo.lastUpdated),
        link: encodeURIComponent(record.title),
        length: record.length ?? 0,
        posterURL: poster,
        posterBlurhash: record.posterBlurhash || null,
        title: record.title || record.metadata?.title || null,
        type: type,
        metadata: record.metadata || null,
        media: record,
      }
    }
  } catch (e) {
    console.log(e)
    return null
  }
}
