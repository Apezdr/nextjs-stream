import axios from 'axios'
import { convertToDate, getFullImageUrl } from '../utils'

async function getMetadata({ title, season = null, episode = null, type, tmdb_id = null }) {
  // Use TMDb for movies
  if (type === 'movie') {
    let url
    if (tmdb_id) {
      url = `https://api.themoviedb.org/3/movie/${tmdb_id}?api_key=${TMDB_API_KEY}`
    } else {
      url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(
        title
      )}`
    }

    try {
      const searchResponse = await axios.get(url)
      if (tmdb_id || searchResponse.data.results.length > 0) {
        const movieId = tmdb_id || searchResponse.data.results[0].id

        const detailsUrl = `https://api.themoviedb.org/3/movie/${movieId}?api_key=${TMDB_API_KEY}`
        const movieDetailsResponse = await axios.get(detailsUrl)

        let data = { ...movieDetailsResponse.data }

        // Fetch logos if available
        const logosUrl = `https://api.themoviedb.org/3/movie/${movieId}/images?api_key=${TMDB_API_KEY}`
        const logosResponse = await axios.get(logosUrl)
        const logo =
          logosResponse.data.logos && logosResponse.data.logos.length > 0
            ? logosResponse.data.logos[0].file_path
            : null

        if (logo) {
          data.logo_path = logo
        }

        // Fetch trailer if available
        const videosUrl = `https://api.themoviedb.org/3/movie/${movieId}/videos?api_key=${TMDB_API_KEY}`
        const videosResponse = await axios.get(videosUrl)
        const trailer = videosResponse.data.results.find(
          (video) => video.type === 'Trailer' && video.site === 'YouTube'
        )

        if (trailer) {
          data.trailer_url = `https://www.youtube.com/watch?v=${trailer.key}`
        }

        // Convert 'Released' dates if present
        if (data.release_date) {
          data.release_date = convertToDate(data.release_date)
        }

        return data
      } else {
        return null // Movie not found
      }
    } catch (error) {
      console.error('Error fetching movie metadata:', error)
      return null
    }
  } else {
    // Use TMDb for TV show season and episode details
    try {
      const searchResponse = await axios.get(
        `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(
          title
        )}`
      )
      if (searchResponse.data.results.length > 0) {
        const tvShowId = searchResponse.data.results[0].id

        // Fetch TV show details to get high-quality poster path
        const tvShowDetailsResponse = await axios.get(
          `https://api.themoviedb.org/3/tv/${tvShowId}?api_key=${TMDB_API_KEY}`
        )
        const tvShowPosterPath = tvShowDetailsResponse.data.poster_path
        const highQualityPosterUrl = tvShowPosterPath ? getFullImageUrl(tvShowPosterPath) : null

        let apiResponse
        if (season && episode) {
          // Fetch episode details
          apiResponse = await axios.get(
            `https://api.themoviedb.org/3/tv/${tvShowId}/season/${season}/episode/${episode}?api_key=${TMDB_API_KEY}`
          )
        } else if (season) {
          // Fetch season details
          apiResponse = await axios.get(
            `https://api.themoviedb.org/3/tv/${tvShowId}/season/${season}?api_key=${TMDB_API_KEY}`
          )
        } else {
          // Use TV show details
          apiResponse = tvShowDetailsResponse
        }

        // Add high-quality poster image URL to the response if not already present
        if (highQualityPosterUrl && apiResponse.data) {
          apiResponse.data.high_quality_poster = highQualityPosterUrl
        }

        return apiResponse.data
      } else {
        return null // TV show not found
      }
    } catch (error) {
      console.error('Error fetching TV show metadata:', error)
      return null
    }
  }
}

export default getMetadata
