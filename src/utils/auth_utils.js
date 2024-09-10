export const movieProjectionFields = {
  _id: 0,
  mediaLastModified: 1,
  posterURL: 1,
  posterBlurhash: 1,
  title: 1,
  dimensions: 1,
  'metadata.overview': 1,
  'metadata.release_date': 1,
  'metadata.genres': 1,
}

export const tvShowProjectionFields = {
  _id: 0,
  posterURL: 1,
  posterBlurhash: 1,
  title: 1,
  'metadata.overview': 1,
  'metadata.last_air_date': 1,
  'metadata.networks': 1,
  'metadata.genres': 1,
  'metadata.status': 1,
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
