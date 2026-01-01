import { buildURL } from '@src/utils'

/**
 * Builds the API endpoint for fetching media details in the PopupCard
 * 
 * @param {Object} params - The parameters for building the endpoint
 * @param {boolean} params.isAvailable - Whether the content is available in library
 * @param {string} params.type - Media type ('movie' or 'tv')
 * @param {string} params.mediaId - The media ID
 * @param {number} [params.seasonNumber] - Season number (for TV shows)
 * @param {number} [params.episodeNumber] - Episode number (for TV shows)
 * @param {Object} [params.metadata] - TMDB metadata (for unavailable items)
 * @returns {string} The constructed API endpoint URL
 */
export const getApiEndpoint = ({ isAvailable, type, mediaId, seasonNumber, episodeNumber, metadata }) => {
  if (isAvailable !== false) {
    const baseParams = `mediaId=${mediaId}&mediaType=${type}&card=true`
    const extraParams = type === 'tv' ? `&season=${seasonNumber}&episode=${episodeNumber}` : ''
    return buildURL(`/api/authenticated/media?${baseParams}${extraParams}`)
  }
  return buildURL(`/api/authenticated/tmdb/comprehensive/${type}?tmdb_id=${metadata?.id}&blurhash=true`)
}