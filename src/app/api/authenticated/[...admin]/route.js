import { buildURL } from 'src/utils'
import { isAdmin, isAdminOrWebhook } from '../../../../utils/routeAuth'
import {
  getAllMedia,
  getAllUsers,
  getLastSynced,
  getRecentlyWatched,
} from 'src/utils/admin_database'
import { processMediaData, processUserData } from 'src/utils/admin_utils'
import axios from 'axios'
import {
  syncCaptions,
  syncChapters,
  syncEpisodeThumbnails,
  syncLengthAndDimensions,
  syncLogos,
  syncMetadata,
  syncMissingMedia,
  syncVideoURL,
  updateLastSynced,
} from 'src/utils/admin_frontend_database'

export async function GET(request, { params }) {
  const authResult = await isAdmin(request)
  if (authResult instanceof Response) {
    return authResult
  }

  const slugs = params.admin // This is an array
  const fetchMedia = slugs.includes('media') && slugs[0] === 'admin'
  const fetchUsers = slugs.includes('users') && slugs[0] === 'admin'
  const fetchRecentlyWatched = slugs.includes('recently-watched') && slugs[0] === 'admin'
  const fetchLastSynced = slugs.includes('lastSynced') && slugs[0] === 'admin'

  let response = {}

  if (fetchMedia) {
    const allRecords = await getAllMedia()
    response.processedData = processMediaData(allRecords)
  }

  if (fetchUsers) {
    const allUsers = await getAllUsers()
    response.processedUserData = processUserData(allUsers)
  }

  if (fetchRecentlyWatched) {
    const recentlyWatched = await getRecentlyWatched()
    response = recentlyWatched
  }

  if (fetchLastSynced) {
    const lastSynced = await getLastSynced()
    response = { lastSyncTime: lastSynced }
  }

  // Ensure that at least one type of data is included
  if (!fetchMedia && !fetchUsers && !fetchRecentlyWatched && !fetchLastSynced && slugs.length > 0) {
    return new Response(JSON.stringify({ error: 'No valid data type specified' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

// New POST method for handling the sync operation
export async function POST(request, { params }) {
  const authResult = await isAdminOrWebhook(request)
  if (authResult instanceof Response) {
    return authResult
  }
  const webhookId = request.headers.get('X-Webhook-ID') ?? null

  const slugs = params.admin
  const syncOperation = slugs.includes('sync') && slugs[0] === 'admin'

  if (syncOperation) {
    try {
      const { missingMedia, missingMp4 } = await handleSync(webhookId, request)
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Sync operation completed successfully.',
          missingMedia,
          missingMp4,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    } catch (error) {
      console.error('Sync operation failed:', error)
      return new Response(
        JSON.stringify({ error: 'Sync operation failed', details: error.toString() }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }
  }

  // Handle other POST operations or return an error for unsupported operations
  return new Response(JSON.stringify({ error: 'Unsupported operation' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function handleSync(webhookId, request) {
  try {
    // Fetch and process TV shows data
    let response
    try {
      const headers = webhookId ? { 'X-Webhook-ID': webhookId } : {}
      const cookie = request.headers.get('cookie')
      if (cookie) {
        headers['cookie'] = cookie
      }
      response = await axios.get(buildURL('/api/authenticated/list'), { headers })
    } catch (error) {
      console.error('Error fetching data from API:', error)
      // Handle the error based on your requirements
      // For example, you can throw a custom error or return an error response
      throw new Error('Failed to fetch data from the API')
    }

    const { fileServer, currentDB } = await response.data

    console.info('Starting Sync with Fileserver')

    const { missingMedia, missingMp4 } = identifyMissingMedia(fileServer, currentDB)
    await syncMissingMedia(missingMedia, fileServer)
    await syncMetadata(currentDB, fileServer)
    await syncCaptions(currentDB, fileServer)
    await syncChapters(currentDB, fileServer)
    await syncVideoURL(currentDB, fileServer)
    await syncLogos(currentDB, fileServer)
    await syncLengthAndDimensions(currentDB, fileServer)
    await syncEpisodeThumbnails(currentDB, fileServer)
    await updateLastSynced()
    console.info('Finished Sync with Fileserver')
    return { missingMedia, missingMp4 }
  } catch (error) {
    console.error('Sync operation failed:', error)
    throw error // Rethrow to handle in the calling function
  }
}

/**
 * Identifies missing media and MP4 files between the file server and current database.
 * @param {Object} fileServer - The data structure representing media available on the file server.
 * @param {Object} currentDB - The current state of the media database.
 * @returns {Object} An object containing arrays of missing media and MP4 file information.
 */
function identifyMissingMedia(fileServer, currentDB) {
  const missingMedia = { tv: [], movies: [] }
  const missingShowsMap = new Map()

  // Keep track of titles (movie/tv) that don't have a url for the mp4 file
  const missingMp4 = { tv: [], movies: [] }

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
  const episodeRegex = /(?:S\d+E(\d+)|(\d+)) - (.+?)\.[^.]+$/

  // Check for missing TV shows, seasons, and episodes
  Object.keys(fileServer.tv).forEach((showTitle) => {
    const foundShow = currentDB.tv.find((show) => show.title === showTitle)

    if (!foundShow) {
      const seasons = Object.keys(fileServer.tv[showTitle].seasons)
      const seasonsWithEpisodes = seasons.filter(
        (season) => fileServer.tv[showTitle].seasons[season].fileNames.length > 0
      )

      if (seasonsWithEpisodes.length > 0) {
        missingShowsMap.set(showTitle, {
          showTitle,
          seasons: seasonsWithEpisodes,
        })
      } else {
        // If there are no seasons with episodes, add the show to missingMp4.tv
        missingMp4.tv.push(showTitle)
      }
    } else {
      Object.keys(fileServer.tv[showTitle].seasons).forEach((season) => {
        const foundSeason = foundShow.seasons.find((s) => `Season ${s.seasonNumber}` === season)
        const hasFilesForSeason =
          Array.isArray(foundSeason?.fileNames) ||
          foundSeason?.fileNames?.length > 0 ||
          fileServer.tv[showTitle].seasons[season]?.fileNames?.length > 0

        if (!foundSeason && hasFilesForSeason) {
          let show = missingShowsMap.get(showTitle) || { showTitle, seasons: [] }
          show.seasons.push(season)
          missingShowsMap.set(showTitle, show)
        } else if (hasFilesForSeason) {
          const seasonFiles = fileServer.tv[showTitle].seasons[season].fileNames

          // Check if the season has any episodes
          if (seasonFiles.length === 0) {
            missingMp4.tv.push(`${showTitle} - ${season}`)
          } else {
            const missingEpisodes = seasonFiles
              .filter((episodeFileName) => {
                /**
                 * Checks if the given episode file name matches the expected format
                 * and returns whether that episode already exists for the given season
                 */
                const match = episodeFileName.match(episodeRegex)
                if (match) {
                  const episodeNumber = parseInt(match[1] || match[2])
                  return !foundSeason.episodes.some((e) => e.episodeNumber === episodeNumber)
                }
                return false
              })
              .map((episodeFileName) => {
                const length = fileServer.tv[showTitle].seasons[season].lengths[episodeFileName]
                const dimensions =
                  fileServer.tv[showTitle].seasons[season].dimensions[episodeFileName]
                const urls = fileServer.tv[showTitle].seasons[season].urls[episodeFileName]
                return { episodeFileName, length, dimensions, ...urls }
              })

            if (missingEpisodes.length > 0) {
              let show = missingShowsMap.get(showTitle) || { showTitle, seasons: [] }
              show.seasons.push({ season, missingEpisodes })
              missingShowsMap.set(showTitle, show)
            }
          }
        }
      })
    }
  })

  // Convert Map to Array
  const missingMediaArray = Array.from(missingShowsMap.values())
  missingMedia.tv = missingMediaArray

  // Check for missing Movies
  Object.keys(fileServer.movies).forEach((movieTitle) => {
    const foundMovie = currentDB.movies.find((movie) => movie.title === movieTitle)
    if (!foundMovie) {
      // If the movie is missing the url for the mp4 file
      // Add it to the missingMedia array
      if (fileServer.movies[movieTitle].urls.mp4) {
        missingMedia.movies.push(movieTitle)
      } else {
        missingMp4.movies.push(movieTitle)
      }
    }
  })

  return { missingMedia, missingMp4 }
}