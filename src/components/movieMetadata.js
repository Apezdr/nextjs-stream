import axios from 'axios'
import { convertToDate, getFullImageUrl } from '../utils'

const OMDB_API_KEY = process.env.OMDB_API_KEY
const TMDB_API_KEY = process.env.TMDB_API_KEY

async function getMetadata({ title, season = null, episode = null, type }) {
  // Use TMDb for movies
  if (type === 'movie') {
    let url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(
      title
    )}`

    try {
      const searchResponse = await axios.get(url)
      if (searchResponse.data.results.length > 0) {
        const movieId = searchResponse.data.results[0].id

        const detailsUrl = `https://api.themoviedb.org/3/movie/${movieId}?api_key=${TMDB_API_KEY}`
        const movieDetailsResponse = await axios.get(detailsUrl)

        let data = {
          ...movieDetailsResponse.data,
          highQualityPosterUrl: movieDetailsResponse.data.poster_path
            ? `https://image.tmdb.org/t/p/original${movieDetailsResponse.data.poster_path}`
            : null,
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
