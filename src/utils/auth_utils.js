import { buildURL, formatDateToEST, getFullImageUrl } from '@src/utils'
import { fetchMetadata } from '@src/utils/admin_utils'

export const movieProjectionFields = {
  _id: 1,
  mediaLastModified: 1,
  posterURL: 1,
  posterBlurhash: 1,
  backdrop: 1,
  backdropBlurhash: 1,
  title: 1,
  dimensions: 1,
  'metadata.overview': 1,
  'metadata.release_date': 1,
  'metadata.genres': 1,
  'metadata.poster_path': 1,
  'metadata.trailer_url': 1,
}

export const tvShowProjectionFields = {
  _id: 1,
  posterURL: 1,
  posterBlurhash: 1,
  backdrop: 1,
  backdropBlurhash: 1,
  title: 1,
  'metadata.overview': 1,
  'metadata.last_air_date': 1,
  'metadata.networks': 1,
  'metadata.genres': 1,
  'metadata.status': 1,
  'metadata.poster_path': 1,
  'metadata.trailer_url': 1,
  seasons: 1,
}

// Helper function to get the latest modified date for both movies and TV shows
export function getModifiedDate(media) {
  if (media.mediaLastModified) {
    // Return the movie's mediaLastModified if it exists
    return new Date(media.mediaLastModified).getTime()
  } else if (media.seasons && Array.isArray(media.seasons)) {
    // Return the most recent episode's mediaLastModified date for TV shows
    const latestEpisodeDate = getLatestEpisodeModifiedDate(media)
    return latestEpisodeDate ? new Date(latestEpisodeDate).getTime() : 0
  }
  return 0 // Default to 0 if no date is found
}

// Helper function to get the latest modified date for TV shows
export function getLatestEpisodeModifiedDate(tvShow) {
  if (!tvShow.seasons || !Array.isArray(tvShow.seasons)) return null

  const episodes = tvShow.seasons.flatMap((season) => season.episodes || [])
  const latestEpisode = episodes.reduce((latest, episode) => {
    const episodeModifiedDate = new Date(episode.mediaLastModified).getTime()
    return episodeModifiedDate > latest ? episodeModifiedDate : latest
  }, 0)

  return latestEpisode || 0 // Return 0 if no valid date is found
}

/**
 * Helper function to arrange media regardless of type by the latest modification date
 * @param {Array} moviesWithUrl - Array of movies with URL
 * @param {Array} tvShowsWithUrl - Array of TV shows with URL
 * @returns {Array} - Combined and sorted media array
 */
export function arrangeMediaByLatestModification(moviesWithUrl, tvShowsWithUrl) {
  // Merge and sort
  const combinedMedia = [...moviesWithUrl, ...tvShowsWithUrl].sort((a, b) => {
    const aModified = getModifiedDate(a)
    const bModified = getModifiedDate(b)

    // Sort in descending order
    return bModified - aModified
  })
  return combinedMedia
}

/**
 * Extract detailed TV show information from the pre-fetched data.
 *
 * @param {Object} tvDetails - The pre-fetched TV show details.
 * @param {string} videoId - The video URL.
 * @returns {Promise<Object|null>} The detailed TV show information or null if not found.
 */
async function extractTVShowDetailsFromMap(tvDetails, videoId) {
  const { title: showTitle, seasons, metadata } = tvDetails
  const [_, showPath] = videoId?.split('/tv/') ?? [null, null]
  const parts = showPath?.split('/')
  let returnData = {}

  if (parts?.length < 3) {
    return null
  }

  const showTitleDecoded = decodeURIComponent(parts[0].replace(/_/g, ' '))
  const seasonPartDecoded = decodeURIComponent(parts[1])
  const episodeFileNameDecoded = decodeURIComponent(parts[2])

  const seasonNumber = parseInt(seasonPartDecoded.match(/\d+/)[0])

  const season = seasons.find((s) => s.seasonNumber === seasonNumber)
  if (!season) {
    return null
  }

  const episode = season.episodes.find((e) => e.videoURL === videoId)
  if (!episode) {
    return null
  }

  // Find the episode metadata matching seasonNumber and episodeNumber
  let episodeMetadata = null
  if (season.metadata && season.metadata.episodes) {
    episodeMetadata = season.metadata.episodes.find(
      (epMeta) =>
        epMeta.season_number === seasonNumber && epMeta.episode_number === episode.episodeNumber
    )
  }

  // Attach the metadata to the episode object
  if (episodeMetadata) {
    episode.metadata = episodeMetadata
  }

  returnData = {
    id: tvDetails._id,
    title: showTitleDecoded,
    showTitleFormatted: `${showTitleDecoded} S${seasonNumber
      .toString()
      .padStart(2, '0')}E${episode.episodeNumber.toString().padStart(2, '0')}`,
    seasonNumber,
    seasons: seasons,
    posterURL: episode.thumbnail ?? '/sorry-image-not-available.jpg',
    backdrop: tvDetails.backdrop ?? null,
    metadata: metadata,
    episode,
  }

  if (tvDetails.logo) {
    returnData.logo = tvDetails.logo
  }

  // Replace the posterBlurhash with the episode's thumbnail blurhash if available
  if (episode.thumbnailBlurhash) {
    returnData.posterBlurhash = episode.thumbnailBlurhash
  }

  if (tvDetails.backdropBlurhash) {
    returnData.backdropBlurhash = tvDetails.backdropBlurhash
  }

  return returnData
}

export async function processWatchedDetails(lastWatched, movieMap, tvMap, limit) {
  const results = []
  for (const video of lastWatched[0].videosWatched) {
    // If we've reached the limit, break out of the loop
    if (results.length >= limit) break

    const movie = movieMap.get(video.videoId)
    if (movie) {
      const sanitizedMovie = await sanitizeRecord(movie, 'movie', video)
      if (sanitizedMovie) {
        results.push(sanitizedMovie)
      }
      continue // Move to the next video
    }

    const tvDetails = tvMap.get(video.videoId)
    if (tvDetails) {
      const detailedTVShow = await extractTVShowDetailsFromMap(tvDetails, video.videoId)
      if (detailedTVShow) {
        const sanitizedData = await sanitizeRecord(detailedTVShow, 'tv', video)
        if (sanitizedData) {
          results.push(sanitizedData)
        }
      }
    }
  }
  return results
}

/**
 * Sanitize record to a consistent format
 * @param {Object} record - The media record
 * @param {string} type - The type of media (movie or TV)
 * @returns {Object} The sanitized record
 */
export async function sanitizeRecord(record, type, lastWatchedVideo) {
  try {
    let poster = record.posterURL || getFullImageUrl(record.metadata?.poster_path)
    let posterBlurhash = false
    let backdropBlurhash = false
    let thumbnailBlurhash = false
    if (!poster) {
      poster = buildURL(`/sorry-image-not-available.jpg`)
    }
    if (record._id ?? record.id) {
      record.id = record._id ? record._id.toString() : record.id.toString()
      delete record?._id
    }

    const metadataPromises = []
    if (record.posterBlurhash) {
      metadataPromises.push(fetchMetadata(record.posterBlurhash, 'blurhash', record.title, type))
      delete record.posterBlurhash
    }

    if (record.backdropBlurhash) {
      metadataPromises.push(fetchMetadata(record.backdropBlurhash, 'blurhash', record.title, type))
      delete record.backdropBlurhash
    }

    if (record?.episode?.thumbnailBlurhash) {
      metadataPromises.push(
        fetchMetadata(record?.episode?.thumbnailBlurhash, 'blurhash', record.title, type)
      )
      delete record?.episode?.thumbnailBlurhash
    }

    const [_posterBlurhash, _backdropBlurhash, _thumbnailBlurhash] =
      await Promise.all(metadataPromises)
    posterBlurhash = _posterBlurhash
    backdropBlurhash = _backdropBlurhash
    thumbnailBlurhash = _thumbnailBlurhash

    if (type === 'tv' && record.episode) {
      return {
        id: record.id,
        date: formatDateToEST(lastWatchedVideo.lastUpdated),
        link: `${record.title}/${record.seasonNumber}/${record.episode.episodeNumber}`,
        length: record.length ?? 0,
        posterURL: poster,
        posterBlurhash: posterBlurhash || null,
        backdrop: record.backdrop || getFullImageUrl(record.metadata.backdrop_path) || null,
        backdropBlurhash: backdropBlurhash || null,
        title: record.showTitleFormatted || null,
        logo: record.logo || getFullImageUrl(record.metadata.logo_path) || null,
        type: type,
        metadata: record.metadata || null,
        seasons: record.seasons,
        media: {
          showTitle: record.title,
          seasonNumber: record.seasonNumber,
          episode: {
            episodeNumber: record.episode.episodeNumber,
            title: record.episode.title,
            videoURL: record.episode.videoURL,
            mediaLastModified: record.episode.mediaLastModified,
            length: record.episode.length,
            dimensions: record.episode.dimensions,
            thumbnail: record.episode.thumbnail,
            thumbnailBlurhash: thumbnailBlurhash,
            captionURLs: record.episode.captionURLs,
            metadata: record.episode.metadata,
          },
        },
      }
    } else {
      return {
        id: record.id,
        date: formatDateToEST(lastWatchedVideo.lastUpdated),
        link: encodeURIComponent(record.title),
        length: record.length ?? 0,
        posterURL: poster,
        posterBlurhash: posterBlurhash || null,
        backdrop: record.backdrop || getFullImageUrl(record.metadata.backdrop_path) || null,
        backdropBlurhash: backdropBlurhash || null,
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

/**
 * Sanitizes a single media item to include only the required fields for the Card component.
 *
 * @param {Object} item - The media item to sanitize.
 * @param {boolean} popup - Whether the item is being used in a popup.
 * @returns {Object|null} - The sanitized media item or null if the item is falsy.
 */
export async function sanitizeCardData(item, popup = false) {
  if (!item) return null

  const {
    id,
    title,
    posterURL,
    posterBlurhash,
    backdrop,
    backdropBlurhash,
    type,
    date,
    link,
    logo,
    metadata,
    // tv
    media,
  } = item

  const sanitized = {}

  if (id) sanitized.id = id
  if (title) sanitized.title = title
  if (posterURL) sanitized.posterURL = posterURL
  if (posterBlurhash) sanitized.posterBlurhash = posterBlurhash
  if (backdrop) sanitized.backdrop = backdrop
  if (backdropBlurhash) sanitized.backdropBlurhash = backdropBlurhash
  if (type) sanitized.type = type
  if (date) sanitized.date = date
  if (link) sanitized.link = link
  if (logo) sanitized.logo = logo
  // tv
  if (media?.seasonNumber) sanitized.seasonNumber = media?.seasonNumber
  if (media?.episode?.episodeNumber) sanitized.episodeNumber = media?.episode?.episodeNumber

  if (popup) {
    if (metadata?.trailer_url) sanitized.trailer_url = metadata?.trailer_url
    if (item?.thumbnail) sanitized.thumbnail = item?.thumbnail
    if (item?.thumbnailBlurhash) sanitized.thumbnailBlurhash = await fetchMetadata(item?.thumbnailBlurhash)
    // Description
    if (metadata?.overview) sanitized.description = metadata?.overview
    if (metadata?.name) sanitized.title = metadata?.name
  }

  return sanitized
}

/**
 * Sanitizes an array of media items.
 *
 * @param {Array} items - The array of media items to sanitize.
 * @returns {Array} - The array of sanitized media items.
 */
export async function sanitizeCardItems(items) {
  if (!Array.isArray(items)) return []
  const sanitizedItems = await Promise.all(items.map((item) => sanitizeCardData(item)))
  return sanitizedItems.filter(Boolean)
}
