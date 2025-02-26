import { fetchMetadataMultiServer } from '../admin_utils'
import { matchEpisodeFileName, extractEpisodeDetails, createFullUrl, processCaptionURLs } from './utils'

/**
 * Identifies missing media and MP4 files between the file server and current database.
 * @param {Object} fileServer - File server data
 * @param {Object} currentDB - Current database state
 * @returns {Object} Missing media and MP4 files
 */
export async function identifyMissingMedia(fileServer, currentDB) {
  const missingMedia = { tv: [], movies: [] }
  const missingShowsMap = new Map()

  // Keep track of titles (movie/tv) that don't have a url for the mp4 file
  const missingMp4 = { tv: [], movies: [] }

  // Check for missing TV shows, seasons, and episodes
  Object.keys(fileServer?.tv).forEach((showTitle) => {
    const foundShow = currentDB.tv.find((show) => show.title === showTitle)

    if (!foundShow) {
      const seasons = Object.keys(fileServer?.tv[showTitle].seasons)
      const seasonsWithEpisodes = seasons.filter(
        (season) => Object.keys(fileServer?.tv[showTitle].seasons[season].episodes).length > 0
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
      Object.keys(fileServer?.tv[showTitle].seasons).forEach((season) => {
        const foundSeason = foundShow.seasons.find((s) => `Season ${s.seasonNumber}` === season)
        const episodes = fileServer?.tv[showTitle].seasons[season]?.episodes || {}

        const hasFilesForSeason =
          Array.isArray(foundSeason?.fileNames) ||
          foundSeason?.fileNames?.length > 0 ||
          Object.keys(episodes).length > 0

        if (!foundSeason && hasFilesForSeason) {
          let show = missingShowsMap.get(showTitle) || { showTitle, seasons: [] }
          show.seasons.push(season)
          missingShowsMap.set(showTitle, show)
        } else if (hasFilesForSeason) {
          // Check if the season has any episodes
          if (Object.keys(episodes).length === 0) {
            missingMp4.tv.push(`${showTitle} - ${season}`)
          } else {
            const missingEpisodes = Object.keys(episodes)
              .filter((episodeKey) => {
                const foundEpisode = foundSeason.episodes.find(
                  (e) => `S${String(foundSeason.seasonNumber).padStart(2,'0')}E${String(e.episodeNumber).padStart(2,'0')}` === episodeKey
                )
                return !foundEpisode
              })
              .map((episodeKey) => {
                const length = fileServer?.tv[showTitle].seasons[season].lengths[episodeKey]
                const dimensions = fileServer?.tv[showTitle].seasons[season].dimensions[episodeKey]
                const episode = episodes[episodeKey]
                return { episodeKey, length, dimensions, ...episode }
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
  Object.keys(fileServer?.movies).forEach((movieTitle) => {
    const foundMovie = currentDB.movies.find((movie) => movie.title === movieTitle)
    if (!foundMovie) {
      // If the movie is missing the url for the mp4 file
      // Add it to the missingMedia array
      if (fileServer?.movies[movieTitle].urls.mp4) {
        missingMedia.movies.push(movieTitle)
      } else {
        missingMp4.movies.push(movieTitle)
      }
    }
  })

  return { missingMedia, missingMp4 }
}

/**
 * Processes movie data from file server.
 * @param {string} movieTitle - Movie title
 * @param {Object} movieData - Movie data
 * @param {Object} serverConfig - Server configuration
 * @returns {Object|null} Processed movie data or null
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

/**
 * Processes show data from file server.
 * @param {Object} showData - Show data
 * @param {Object} showMetadata - Show metadata
 * @param {Object} currentShow - Current show data
 * @param {Object} serverConfig - Server configuration
 * @returns {Object} Processed show data
 */
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
 * Extracts season information from file server data.
 * @param {Object} seasonInfo - Season info
 * @param {string} showTitle - Show title
 * @param {Object} fileServer - File server data
 * @param {Object} serverConfig - Server configuration
 * @returns {Object} Extracted season info
 */
export function extractSeasonInfo(seasonInfo, showTitle, fileServer, serverConfig) {
  try {
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
    console.error('Error Processing', showTitle, seasonInfo, error)
    throw error
  }
}
