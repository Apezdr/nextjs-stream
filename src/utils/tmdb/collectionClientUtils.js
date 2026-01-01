/**
 * Enhanced TMDB utilities specifically for collection data aggregation and enhancement
 * Extends the basic TMDB client with collection-specific functionality
 */

import { getTMDBImageURL, getAccurateDuration } from './client'

/**
 * Aggregate statistics and contributor data from enhanced movie data
 * @param {Array} enhancedMovies - Movies with credits, videos, and images
 * @returns {Object} Aggregated statistics and contributor data
 */
export function aggregateCollectionData(enhancedMovies) {
  try {
    console.log(`[COLLECTION_ENHANCEMENT] Aggregating data from ${enhancedMovies.length} movies`)
    
    // Filter out movies that failed to load enhanced data
    const validMovies = enhancedMovies.filter(movie => movie.credits !== null)
    
    console.log(`[COLLECTION_ENHANCEMENT] ${validMovies.length} movies have valid enhancement data`)
    
    const aggregatedData = {
      topCast: aggregateTopCast(validMovies),
      topDirectors: aggregateTopDirectors(validMovies),
      topWriters: aggregateTopWriters(validMovies),
      statistics: calculateCollectionStatistics(enhancedMovies), // Use all movies for stats
      featuredTrailer: findBestTrailer(validMovies),
      featuredArtwork: selectFeaturedArtwork(validMovies)
    }
    
    console.log(`[COLLECTION_ENHANCEMENT] Aggregation complete - found ${aggregatedData.topCast.length} top cast, ${aggregatedData.topDirectors.length} directors`)
    
    return aggregatedData
    
  } catch (error) {
    console.error(`[COLLECTION_ENHANCEMENT] Error aggregating collection data: ${error.message}`)
    // Return empty aggregated data rather than failing
    return {
      topCast: [],
      topDirectors: [],
      topWriters: [],
      statistics: null,
      featuredTrailer: null,
      featuredArtwork: null
    }
  }
}

/**
 * Aggregate top cast members across the collection
 * @param {Array} movies - Movies with credits data
 * @returns {Array} Top cast members sorted by appearance frequency and billing
 */
export function aggregateTopCast(movies) {
  const castFrequency = new Map()
  
  movies.forEach(movie => {
    if (movie.credits?.cast) {
      // Only consider top 15 billed actors per movie to focus on main cast
      movie.credits.cast.slice(0, 15).forEach((castMember, index) => {
        const key = castMember.id
        
        if (!castFrequency.has(key)) {
          castFrequency.set(key, {
            id: castMember.id,
            name: castMember.name,
            profile_path: castMember.profile_path,
            appearances: 0,
            movies: [],
            totalOrder: 0,
            characters: []
          })
        }
        
        const existing = castFrequency.get(key)
        existing.appearances++
        existing.movies.push(movie.title)
        existing.totalOrder += index // Lower numbers mean higher billing
        if (castMember.character) {
          existing.characters.push(castMember.character)
        }
      })
    }
  })
  
  return Array.from(castFrequency.values())
    .filter(actor => actor.appearances >= 1) // At least 1 appearance
    .sort((a, b) => {
      // Primary sort: by number of appearances (descending)
      if (a.appearances !== b.appearances) {
        return b.appearances - a.appearances
      }
      // Secondary sort: by average billing order (ascending - lower is better)
      return (a.totalOrder / a.appearances) - (b.totalOrder / b.appearances)
    })
    .slice(0, 12) // Return top 12 cast members
}

/**
 * Aggregate top directors across the collection
 * @param {Array} movies - Movies with crew credits data
 * @returns {Array} Directors sorted by number of movies directed
 */
export function aggregateTopDirectors(movies) {
  const directorFrequency = new Map()
  
  movies.forEach(movie => {
    if (movie.credits?.crew) {
      const directors = movie.credits.crew.filter(member => member.job === 'Director')
      
      directors.forEach(director => {
        const key = director.id
        
        if (!directorFrequency.has(key)) {
          directorFrequency.set(key, {
            id: director.id,
            name: director.name,
            profile_path: director.profile_path,
            movieCount: 0,
            movieTitles: []
          })
        }
        
        const existing = directorFrequency.get(key)
        existing.movieCount++
        existing.movieTitles.push(movie.title)
      })
    }
  })
  
  return Array.from(directorFrequency.values())
    .sort((a, b) => b.movieCount - a.movieCount)
    .slice(0, 6) // Return top 6 directors
}

/**
 * Aggregate top writers across the collection
 * @param {Array} movies - Movies with crew credits data
 * @returns {Array} Writers sorted by number of movies written
 */
export function aggregateTopWriters(movies) {
  const writerFrequency = new Map()
  
  movies.forEach(movie => {
    if (movie.credits?.crew) {
      // Include various writing roles
      const writers = movie.credits.crew.filter(member => 
        ['Screenplay', 'Writer', 'Story', 'Characters'].includes(member.job)
      )
      
      writers.forEach(writer => {
        const key = writer.id
        
        if (!writerFrequency.has(key)) {
          writerFrequency.set(key, {
            id: writer.id,
            name: writer.name,
            profile_path: writer.profile_path,
            movieCount: 0,
            movieTitles: [],
            jobs: new Set()
          })
        }
        
        const existing = writerFrequency.get(key)
        existing.movieCount++
        existing.movieTitles.push(movie.title)
        existing.jobs.add(writer.job)
      })
    }
  })
  
  return Array.from(writerFrequency.values())
    .map(writer => ({
      ...writer,
      jobs: Array.from(writer.jobs) // Convert Set to Array
    }))
    .sort((a, b) => b.movieCount - a.movieCount)
    .slice(0, 4) // Return top 4 writers
}

/**
 * Calculate comprehensive collection statistics
 * @param {Array} movies - All movies in the collection (including those without enhanced data)
 * @returns {Object} Collection-wide statistics
 */
export function calculateCollectionStatistics(movies) {
  const validMovies = movies.filter(m => m.vote_average && m.release_date)
  
  if (validMovies.length === 0) {
    return null
  }
  
  // Calculate average rating (weighted by vote count)
  const totalVotes = validMovies.reduce((sum, m) => sum + (m.vote_count || 0), 0)
  const weightedRatingSum = validMovies.reduce((sum, m) => {
    const weight = (m.vote_count || 0) / totalVotes || 1 / validMovies.length
    return sum + (m.vote_average * weight)
  }, 0)
  
  // Calculate total runtime prioritizing database duration over TMDB data
  const moviesWithRuntime = movies.map(m => {
    const duration = getAccurateDuration(m);
    return duration ? duration.minutes : null;
  }).filter(Boolean);
  
  const totalRuntime = moviesWithRuntime.reduce((sum, minutes) => sum + minutes, 0)
  
  // Genre breakdown
  const genreBreakdown = calculateGenreBreakdown(validMovies)
  
  // Release span
  const releaseDates = validMovies
    .map(m => m.release_date)
    .filter(Boolean)
    .sort()
  
  const releaseSpan = releaseDates.length > 0 ? {
    earliest: releaseDates[0],
    latest: releaseDates[releaseDates.length - 1],
    spanYears: new Date(releaseDates[releaseDates.length - 1]).getFullYear() - 
               new Date(releaseDates[0]).getFullYear()
  } : null
  
  // Production companies (from enhanced metadata)
  const productionCompanies = aggregateProductionCompanies(movies)
  
  return {
    averageRating: weightedRatingSum,
    totalRuntime,
    averageRuntime: moviesWithRuntime.length > 0 ? Math.round(totalRuntime / moviesWithRuntime.length) : null,
    genreBreakdown,
    releaseSpan,
    productionCompanies,
    movieCount: movies.length,
    validDataCount: validMovies.length
  }
}

/**
 * Calculate genre distribution across movies
 * @param {Array} movies - Movies with genre data
 * @returns {Array} Genre breakdown with counts and percentages
 */
function calculateGenreBreakdown(movies) {
  const genreCounts = new Map()
  const totalMovies = movies.length
  
  movies.forEach(movie => {
    if (movie.genres) {
      movie.genres.forEach(genre => {
        const current = genreCounts.get(genre.id) || { ...genre, count: 0 }
        current.count++
        genreCounts.set(genre.id, current)
      })
    }
  })
  
  return Array.from(genreCounts.values())
    .map(genre => ({
      ...genre,
      percentage: Math.round((genre.count / totalMovies) * 100)
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8) // Top 8 genres
}

/**
 * Aggregate production companies across the collection
 * @param {Array} movies - Movies with enhanced metadata
 * @returns {Array} Production companies with counts
 */
function aggregateProductionCompanies(movies) {
  const companyCounts = new Map()
  
  movies.forEach(movie => {
    if (movie.enhancedMetadata?.production_companies) {
      movie.enhancedMetadata.production_companies.forEach(company => {
        const current = companyCounts.get(company.id) || { ...company, count: 0 }
        current.count++
        companyCounts.set(company.id, current)
      })
    }
  })
  
  return Array.from(companyCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5) // Top 5 production companies
}

/**
 * Find the best trailer to feature for the collection
 * @param {Array} movies - Movies with video data
 * @returns {Object|null} Best trailer information
 */
export function findBestTrailer(movies) {
  let bestTrailer = null
  let bestScore = 0
  
  movies.forEach(movie => {
    if (movie.videos?.results) {
      const trailers = movie.videos.results.filter(video => 
        video.type === 'Trailer' && video.site === 'YouTube'
      )
      
      trailers.forEach(trailer => {
        // Score trailers based on quality and type
        let score = 0
        
        // Prefer official trailers
        if (trailer.name.toLowerCase().includes('official')) score += 3
        if (trailer.name.toLowerCase().includes('main')) score += 2
        
        // Prefer higher quality
        if (trailer.size >= 1080) score += 2
        else if (trailer.size >= 720) score += 1
        
        // Prefer more recent movies (proxy for better trailer quality)
        const releaseYear = movie.release_date ? new Date(movie.release_date).getFullYear() : 0
        if (releaseYear >= 2010) score += 1
        if (releaseYear >= 2020) score += 1
        
        if (score > bestScore) {
          bestScore = score
          bestTrailer = {
            movieId: movie.id,
            movieTitle: movie.title,
            trailerKey: trailer.key,
            trailerName: trailer.name,
            trailerSite: trailer.site,
            trailerSize: trailer.size
          }
        }
      })
    }
  })
  
  return bestTrailer
}

/**
 * Select featured artwork from across the collection
 * @param {Array} movies - Movies with image data
 * @returns {Object} Featured artwork selections
 */
export function selectFeaturedArtwork(movies) {
  const backdrops = []
  const posters = []
  const logos = []
  
  movies.forEach(movie => {
    if (movie.images) {
      // Select high-quality backdrops
      if (movie.images.backdrops) {
        movie.images.backdrops
          .filter(backdrop => backdrop.vote_average >= 5.5 && backdrop.width >= 1920)
          .slice(0, 2) // Top 2 per movie
          .forEach(backdrop => {
            backdrops.push({
              ...backdrop,
              movieTitle: movie.title,
              fullPath: getTMDBImageURL(backdrop.file_path, 'original')
            })
          })
      }
      
      // Select variety of posters
      if (movie.images.posters) {
        movie.images.posters
          .filter(poster => poster.vote_average >= 5.0)
          .slice(0, 1) // Best poster per movie
          .forEach(poster => {
            posters.push({
              ...poster,
              movieTitle: movie.title,
              fullPath: getTMDBImageURL(poster.file_path, 'w780')
            })
          })
      }
      
      // Collect logos if available
      if (movie.images.logos) {
        movie.images.logos
          .filter(logo => logo.file_path && logo.vote_average >= 5.0)
          .slice(0, 1)
          .forEach(logo => {
            logos.push({
              ...logo,
              movieTitle: movie.title,
              fullPath: getTMDBImageURL(logo.file_path, 'w500')
            })
          })
      }
    }
  })
  
  return {
    backdrops: backdrops
      .sort((a, b) => b.vote_average - a.vote_average)
      .slice(0, 8), // Top 8 backdrops
    posters: posters
      .sort((a, b) => b.vote_average - a.vote_average)
      .slice(0, 12), // Top 12 posters for variety
    logos: logos
      .sort((a, b) => b.vote_average - a.vote_average)
      .slice(0, 6) // Top 6 logos
  }
}

/**
 * Format runtime in hours and minutes
 * @param {number} totalMinutes - Total runtime in minutes
 * @returns {string} Formatted runtime string
 */
export function formatRuntime(totalMinutes) {
  if (!totalMinutes || totalMinutes <= 0) return 'Unknown'
  
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  
  if (hours === 0) {
    return `${minutes}m`
  } else if (minutes === 0) {
    return `${hours}h`
  } else {
    return `${hours}h ${minutes}m`
  }
}

/**
 * Get contributor filter function for filtering movies by cast/crew
 * @param {Object} contributor - The contributor to filter by
 * @param {string} contributor.type - 'actor' or 'director'
 * @param {number} contributor.id - TMDB person ID
 * @returns {Function} Filter function for movies
 */
export function getContributorFilter(contributor) {
  if (!contributor) return null
  
  return (movie) => {
    if (!movie.credits) return false
    
    if (contributor.type === 'actor') {
      return movie.credits.cast?.some(actor => actor.id === contributor.id)
    } else if (contributor.type === 'director') {
      return movie.credits.crew?.some(crew => 
        crew.id === contributor.id && crew.job === 'Director'
      )
    }
    
    return false
  }
}