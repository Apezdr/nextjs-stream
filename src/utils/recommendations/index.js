import clientPromise from '@src/lib/mongodb'
import { ObjectId } from 'mongodb'
import { addCustomUrlToMedia } from '@src/utils/auth_database'

  // Import utility functions
import {
  filterValidEpisodes,
  generateUniqueId,
  removeDuplicates,
  findNextEpisode,
  findFirstEpisode,
  paginateItems,
  ensureMediaProperties
} from './utils'

// Import scoring functions
import {
  calculateRecencyScore,
  calculateGenreSimilarity,
  calculatePopularityScore,
  sortRecommendationsByScore,
  addDiversity
} from './scoring'

// Import filtering functions
import {
  filterValidItems,
  filterUnwatchedItems,
  filterByGenres,
  filterTrendingContent,
  filterValidVideoUrls
} from './filters'

// Cache for recommendations to ensure consistency between refreshes
const recommendationsCache = new Map()

/**
 * Get genre-based recommendations for a user based on their watch history
 * 
 * @param {string} userId - The user ID to get recommendations for
 * @param {number} page - The page number for pagination (0-based)
 * @param {number} limit - The number of items to return per page
 * @returns {Promise<Object>} Object containing hasWatched flag, recommended items, and genre info
 */
export async function getGenreBasedRecommendations(userId, page = 0, limit = 30) {
  try {
    const client = await clientPromise
    const db = client.db('Media')

    // Get user's watched videos
    const userPlayback = await db
      .collection('PlaybackStatus')
      .findOne({ userId: new ObjectId(userId) })

    if (!userPlayback || !userPlayback.videosWatched || userPlayback.videosWatched.length === 0) {
      return { hasWatched: false, items: [] }
    }

    // Extract video IDs from watched videos and filter out null/undefined values
    const videoIds = userPlayback.videosWatched
      .map(video => video.videoId)
      .filter(Boolean) // This will filter out null, undefined, empty strings

    // If no valid video IDs after filtering, return empty result
    if (videoIds.length === 0) {
      return { hasWatched: false, items: [] }
    }

    // Find movies and TV shows that match these video IDs
    const [watchedMovies, watchedTVShows] = await Promise.all([
      db.collection('Movies').find({ videoURL: { $in: videoIds } }).toArray(),
      db.collection('TV').aggregate([
        { $match: { "seasons.episodes.videoURL": { $in: videoIds } } },
        { $addFields: { matchedEpisodes: { $filter: {
          input: { $reduce: {
            input: "$seasons",
            initialValue: [],
            in: { $concatArrays: ["$$value", "$$this.episodes"] }
          }},
          as: "episode",
          cond: { $in: ["$$episode.videoURL", videoIds] }
        }}}},
        { $match: { "matchedEpisodes.0": { $exists: true } } }
      ]).toArray()
    ])

    if (watchedMovies.length === 0 && watchedTVShows.length === 0) {
      return { hasWatched: false, items: [] }
    }

    // Log for debugging
    console.log(`Found ${watchedMovies.length} watched movies and ${watchedTVShows.length} watched TV shows for user ${userId}`)

    // Extract genres from watched content
    const genrePreferences = new Map()
    
    // Process movie genres
    watchedMovies.forEach(movie => {
      if (movie.metadata && movie.metadata.genres) {
        movie.metadata.genres.forEach(genre => {
          const genreId = genre.id || genre.name
          const count = genrePreferences.get(genreId) || 0
          genrePreferences.set(genreId, count + 1)
        })
      }
    })
    
    // Process TV show genres
    watchedTVShows.forEach(show => {
      if (show.metadata && show.metadata.genres) {
        show.metadata.genres.forEach(genre => {
          const genreId = genre.id || genre.name
          const count = genrePreferences.get(genreId) || 0
          genrePreferences.set(genreId, count + 1)
        })
      }
    })

    // If no genres found, return empty result
    if (genrePreferences.size === 0) {
      return { hasWatched: true, items: [] }
    }

    // Sort genres by preference count
    const sortedGenres = [...genrePreferences.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(entry => entry[0])
      .slice(0, 3) // Take top 3 genres

    // Create a map of watched video URLs with their metadata for quick lookup
    const watchedVideoURLsMap = new Map();
    userPlayback.videosWatched.forEach(video => {
      if (video.videoId) {
        watchedVideoURLsMap.set(video.videoId, video);
      }
    });
    
    // Create a set of watched video URLs for quick lookup
    const watchedVideoURLs = new Set(videoIds)
    
    // Create a set of watched movie IDs
    const watchedMovieIds = new Set(watchedMovies.map(m => m._id.toString()))
    
    // Create a map of watched TV shows by ID
    const watchedTVShowsMap = new Map()
    watchedTVShows.forEach(show => {
      watchedTVShowsMap.set(show._id.toString(), show)
    })

    // Get total counts to know how many items are available
    const [totalMovies, totalTVShows] = await Promise.all([
      db.collection('Movies').countDocuments({}),
      db.collection('TV').countDocuments({})
    ])
    
    console.log(`Total available for genre recommendations: ${totalMovies} movies and ${totalTVShows} TV shows`)
    
    // Calculate how many items to fetch - use a larger number to ensure we have enough
    // We'll fetch up to 500 items of each type, which should be enough for most cases
    // while still being efficient
    const fetchLimit = Math.min(500, Math.max(100, limit * 5))

    // Query for unwatched movies with matching genres
    const movieQuery = {
      '_id': { $nin: Array.from(watchedMovieIds).map(id => new ObjectId(id)) },
      'metadata.genres.id': { $in: sortedGenres }
    }

    // Fetch movie recommendations with pagination
    const recommendedMovies = await db.collection('Movies')
      .find(movieQuery)
      .sort({ title: 1 }) // Consistent sort for pagination
      .skip(page * Math.ceil(limit / 2))
      .limit(fetchLimit)
      .toArray()

    // Process TV show recommendations - we need to find next episodes for watched shows
    // and new shows with matching genres
    const tvRecommendations = []
    
    // 1. First, find next episodes for shows the user has already started watching
    for (const watchedShow of watchedTVShows) {
      // Find the next episode for this show
      const nextEpisodeInfo = findNextEpisode(watchedShow, watchedVideoURLs);
      
      // If we found a next episode, add it to recommendations
      if (nextEpisodeInfo) {
        tvRecommendations.push({
          ...watchedShow,
          type: 'tv',
          episode: nextEpisodeInfo.episode,
          seasonNumber: nextEpisodeInfo.seasonNumber,
          isNextEpisode: true
        });
      }
    }
    
    // 2. If we need more recommendations, find new shows with matching genres
    if (tvRecommendations.length < Math.ceil(limit / 2)) {
      // How many more TV shows we need
      const remainingTVShows = Math.ceil(limit / 2) - tvRecommendations.length
      
      // Query for unwatched TV shows with matching genres
      const tvQuery = {
        '_id': { $nin: Array.from(watchedTVShowsMap.keys()).map(id => new ObjectId(id)) },
        'metadata.genres.id': { $in: sortedGenres }
      }
      
      const newTVShows = await db.collection('TV')
        .find(tvQuery)
        .limit(remainingTVShows)
        .toArray()
      
      // For each new show, recommend the first episode of the first season
      newTVShows.forEach(show => {
        const firstEpisodeInfo = findFirstEpisode(show);
        
        if (firstEpisodeInfo) {
          tvRecommendations.push({
            ...show,
            type: 'tv',
            episode: firstEpisodeInfo.episode,
            seasonNumber: firstEpisodeInfo.seasonNumber,
            isNewShow: true
          });
        }
      });
    }

    // Remove logo field if it exists
    recommendedMovies.forEach(movie => {
      if (movie.logo) delete movie.logo
    })
    
    tvRecommendations.forEach(show => {
      if (show.logo) delete show.logo
    })

    // Process movies and TV shows to add necessary fields
    let [processedMovies, processedTVShows] = await Promise.all([
      addCustomUrlToMedia(recommendedMovies, 'movie'),
      addCustomUrlToMedia(tvRecommendations, 'tv')
    ])

    // Filter out any items that don't have valid URLs or required fields
    processedMovies = filterValidItems(processedMovies);
    processedTVShows = filterValidItems(processedTVShows);
    
    // Filter out items with invalid video URLs
    processedMovies = filterValidVideoUrls(processedMovies, watchedVideoURLsMap);
    processedTVShows = filterValidVideoUrls(processedTVShows, watchedVideoURLsMap);

    // If we don't have enough recommendations, fetch some random ones
    let recommendations = [...processedMovies, ...processedTVShows]
    
    if (recommendations.length < limit) {
      console.log(`Not enough genre-based recommendations (${recommendations.length}), fetching random ones`)
      
      // How many more items we need
      const remainingItems = limit - recommendations.length
      
      // Fetch random movies and TV shows
      const [randomMovies, randomTVShows] = await Promise.all([
        db.collection('Movies')
          .find({ '_id': { $nin: Array.from(watchedMovieIds).map(id => new ObjectId(id)) } })
          .limit(Math.ceil(remainingItems / 2))
          .toArray(),
        db.collection('TV')
          .find({ '_id': { $nin: Array.from(watchedTVShowsMap.keys()).map(id => new ObjectId(id)) } })
          .limit(Math.ceil(remainingItems / 2))
          .toArray()
      ])
      
      // Process random TV shows to recommend first episodes
      const randomTVShowsWithEpisodes = randomTVShows.map(show => {
        const firstEpisodeInfo = findFirstEpisode(show);
        
        if (firstEpisodeInfo) {
          return {
            ...show,
            type: 'tv',
            episode: firstEpisodeInfo.episode,
            seasonNumber: firstEpisodeInfo.seasonNumber,
            isNewShow: true
          };
        }
        
        return null;
      }).filter(Boolean); // Remove null entries
      
      // Remove logo field if it exists
      randomMovies.forEach(movie => {
        if (movie.logo) delete movie.logo
      })
      
      randomTVShowsWithEpisodes.forEach(show => {
        if (show.logo) delete show.logo
      })
      
      // Process random movies and TV shows
      let [processedRandomMovies, processedRandomTVShows] = await Promise.all([
        addCustomUrlToMedia(randomMovies, 'movie'),
        addCustomUrlToMedia(randomTVShowsWithEpisodes, 'tv')
      ])
      
      // Filter out any items that don't have valid URLs or required fields
      processedRandomMovies = filterValidItems(processedRandomMovies);
      processedRandomTVShows = filterValidItems(processedRandomTVShows);
      
      // Add random recommendations to the list
      recommendations = [...recommendations, ...processedRandomMovies, ...processedRandomTVShows]
      
      // If we still don't have enough recommendations, try one more time with a broader query
      if (recommendations.length < limit) {
        console.log(`Still not enough recommendations (${recommendations.length}), trying with broader query`)
        
        // Get more random movies and TV shows without any filtering
        const [moreRandomMovies, moreRandomTVShows] = await Promise.all([
          db.collection('Movies')
            .find({})
            .limit(limit)
            .toArray(),
          db.collection('TV')
            .find({})
            .limit(limit)
            .toArray()
        ])
        
        // Process more random TV shows
        const moreRandomTVShowsWithEpisodes = moreRandomTVShows.map(show => {
          const firstEpisodeInfo = findFirstEpisode(show);
          
          if (firstEpisodeInfo) {
            return {
              ...show,
              type: 'tv',
              episode: firstEpisodeInfo.episode,
              seasonNumber: firstEpisodeInfo.seasonNumber,
              isNewShow: true
            };
          }
          
          return null;
        }).filter(Boolean);
        
        // Remove logo field
        moreRandomMovies.forEach(movie => {
          if (movie.logo) delete movie.logo
        })
        
        moreRandomTVShowsWithEpisodes.forEach(show => {
          if (show.logo) delete show.logo
        })
        
        // Process more random movies and TV shows
        let [moreProcessedRandomMovies, moreProcessedRandomTVShows] = await Promise.all([
          addCustomUrlToMedia(moreRandomMovies, 'movie'),
          addCustomUrlToMedia(moreRandomTVShowsWithEpisodes, 'tv')
        ])
        
        // Filter out any items that don't have valid URLs or required fields
        moreProcessedRandomMovies = filterValidItems(moreProcessedRandomMovies);
        moreProcessedRandomTVShows = filterValidItems(moreProcessedRandomTVShows);
        
        // Add more random recommendations to the list
        recommendations = [...recommendations, ...moreProcessedRandomMovies, ...moreProcessedRandomTVShows]
      }
    }
    
    // Create a unique ID for each item to ensure we don't have duplicates
    recommendations = recommendations.map(item => ({
      ...item,
      uniqueId: generateUniqueId(item)
    }));
    
    // Remove any duplicates based on uniqueId
    const uniqueRecommendations = removeDuplicates(recommendations);
    
    // Create user preferences object for scoring
    const userPreferences = {
      genres: sortedGenres,
      recentlyWatchedIds: Array.from(watchedMovieIds).concat(
        Array.from(watchedTVShowsMap.keys())
      )
    };
    
    // Score and sort recommendations
    const scoredRecommendations = sortRecommendationsByScore(uniqueRecommendations, userPreferences);
    
    // Add some diversity to the recommendations
    const diverseRecommendations = addDiversity(
      scoredRecommendations.filter(item => item.score >= 0.3), // Lowered threshold from 0.5 to 0.3
      scoredRecommendations.filter(item => item.score < 0.3),  // Lowered threshold from 0.5 to 0.3
      0.2 // Reduced diversity from 0.3 to 0.2 to get more relevant content
    );
    
    // Ensure we have enough items for the requested page
    if (diverseRecommendations.length < (page + 1) * limit) {
      console.log(`Not enough items for page ${page}, returning available items`);
    }
    
    // Skip items based on page
    const paginatedItems = paginateItems(diverseRecommendations, page, limit);

    return { 
      hasWatched: true, 
      items: paginatedItems,
      genres: sortedGenres
    }
  } catch (error) {
    console.error('Error in getGenreBasedRecommendations:', error)
    return { hasWatched: false, items: [], error: error.message }
  }
}

/**
 * Get most popular content based on watch counts
 * 
 * @param {number} page - The page number for pagination (0-based)
 * @param {number} limit - The number of items to return per page
 * @returns {Promise<Array>} Array of popular content items
 */
export async function getMostPopularContent(page = 0, limit = 30) {
  try {
    const client = await clientPromise
    const db = client.db('Media')

    // Aggregate watch counts from PlaybackStatus collection
    const allWatchedVideos = await db.collection('PlaybackStatus')
      .find({})
      .project({ videosWatched: 1 })
      .toArray()
    
    // Create a map of videoId to watch count and metadata
    const watchCountMap = new Map()
    const watchedVideoURLsMap = new Map()
    
    allWatchedVideos.forEach(user => {
      if (user.videosWatched) {
        user.videosWatched.forEach(video => {
          if (video.videoId) { // Only process valid videoIds
            // Update watch count
            const count = watchCountMap.get(video.videoId) || 0
            watchCountMap.set(video.videoId, count + 1)
            
            // Store video metadata for validation
            if (!watchedVideoURLsMap.has(video.videoId)) {
              watchedVideoURLsMap.set(video.videoId, video)
            }
          }
        })
      }
    })
    
    // Get all videoIds
    const allVideoIds = [...watchCountMap.keys()]
    
    // Skip if no valid video IDs
    if (allVideoIds.length === 0) {
      return getRandomRecommendations(page, limit)
    }
    
    // Find corresponding movies and TV shows
    const [movies, tvShows] = await Promise.all([
      db.collection('Movies').find({ videoURL: { $in: allVideoIds } }).toArray(),
      db.collection('TV').aggregate([
        { $match: { "seasons.episodes.videoURL": { $in: allVideoIds } } },
        { $addFields: { matchedEpisodes: { $filter: {
          input: { $reduce: {
            input: "$seasons",
            initialValue: [],
            in: { $concatArrays: ["$$value", "$$this.episodes"] }
          }},
          as: "episode",
          cond: { $in: ["$$episode.videoURL", allVideoIds] }
        }}}},
        { $match: { "matchedEpisodes.0": { $exists: true } } }
      ]).toArray()
    ])

    if (movies.length === 0 && tvShows.length === 0) {
      // If no watch data, just return some random movies and TV shows
      return getRandomRecommendations(page, limit)
    }

    // Process movies with watch counts
    const moviesWithWatchCount = []
    movies.forEach(movie => {
      if (movie.videoURL && watchCountMap.has(movie.videoURL)) {
        // Remove logo if it exists
        if (movie.logo) delete movie.logo
        
        moviesWithWatchCount.push({
          ...movie,
          watchCount: watchCountMap.get(movie.videoURL) || 0,
          type: 'movie'
        })
      }
    })

    // Group TV shows by show ID to find the most popular shows
    const tvShowPopularity = new Map() // Map of show ID to total watch count
    const tvShowEpisodes = new Map() // Map of show ID to episodes
    
    tvShows.forEach(show => {
      const showId = show._id.toString()
      let totalWatchCount = 0
      
      show.seasons.forEach(season => {
        if (season.episodes) {
          season.episodes.forEach(episode => {
            if (episode.videoURL && watchCountMap.has(episode.videoURL)) {
              const watchCount = watchCountMap.get(episode.videoURL) || 0
              totalWatchCount += watchCount
              
              // Store episode data
              if (!tvShowEpisodes.has(showId)) {
                tvShowEpisodes.set(showId, [])
              }
              
              tvShowEpisodes.get(showId).push({
                episode,
                seasonNumber: season.seasonNumber,
                watchCount
              })
            }
          })
        }
      })
      
      if (totalWatchCount > 0) {
        tvShowPopularity.set(showId, {
          show,
          totalWatchCount
        })
      }
    })
    
    // Sort TV shows by popularity
    const sortedTVShows = [...tvShowPopularity.values()]
      .sort((a, b) => b.totalWatchCount - a.totalWatchCount)
      .slice(0, Math.ceil(limit / 2))
    
    // For each popular show, recommend the first episode
    const tvShowsWithWatchCount = []
    
    sortedTVShows.forEach(({ show }) => {
      const showId = show._id.toString()
      const episodes = tvShowEpisodes.get(showId) || []
      
      if (episodes.length > 0) {
        // For popular shows, always recommend the first episode of the first season
        const firstEpisodeInfo = findFirstEpisode(show);
        
        if (firstEpisodeInfo) {
          const tvShowWithCount = {
            ...show,
            watchCount: episodes.reduce((sum, ep) => sum + ep.watchCount, 0),
            type: 'tv',
            episode: firstEpisodeInfo.episode,
            seasonNumber: firstEpisodeInfo.seasonNumber
          };
          
          // Remove logo if it exists
          if (tvShowWithCount.logo) delete tvShowWithCount.logo;
          
          tvShowsWithWatchCount.push(tvShowWithCount);
        }
      }
    })

    // Process with addCustomUrlToMedia
    let [processedMovies, processedTVShows] = await Promise.all([
      addCustomUrlToMedia(moviesWithWatchCount, 'movie'),
      addCustomUrlToMedia(tvShowsWithWatchCount, 'tv')
    ])
    
    // Filter out any items that don't have valid URLs or required fields
    processedMovies = filterValidItems(processedMovies);
    processedTVShows = filterValidItems(processedTVShows);

    // Calculate how many items we need for this page
    const totalNeeded = (page + 1) * limit

    // Create a unique ID for each item to ensure we don't have duplicates
    let combined = [...processedMovies, ...processedTVShows].map(item => ({
      ...item,
      uniqueId: generateUniqueId(item)
    }));
    
    // Remove any duplicates based on uniqueId
    const uniqueItems = removeDuplicates(combined);
    
    // Sort by watch count first, then by title for consistency
    uniqueItems.sort((a, b) => {
      // First sort by watch count (descending)
      const countDiff = b.watchCount - a.watchCount;
      if (countDiff !== 0) return countDiff;
      
      // Then by type
      if (a.type !== b.type) {
        return a.type === 'movie' ? -1 : 1;
      }
      
      // Then by title (alphabetical)
      return a.title.localeCompare(b.title);
    });
    
    // Get total counts to know how many items are available
    const [totalMovies, totalTVShows] = await Promise.all([
      db.collection('Movies').countDocuments({}),
      db.collection('TV').countDocuments({})
    ])
    
    console.log(`Total available for popular content: ${totalMovies} movies and ${totalTVShows} TV shows`)
    
    // If we don't have enough recommendations for the requested page, fetch more random ones
    if (uniqueItems.length < totalNeeded) {
      console.log(`Not enough popular content (${uniqueItems.length}) for page ${page}, fetching random ones`)
      
      // How many more items we need - fetch more than we need to ensure we have enough
      const fetchLimit = Math.min(500, Math.max(100, limit * 5))
      
      // Get random recommendations with pagination
      const randomRecommendations = await getRandomRecommendations(page, fetchLimit)
      
      // Add random recommendations to the list, but only if they're not already included
      const randomWithIds = randomRecommendations.map(item => ({
        ...item,
        uniqueId: generateUniqueId(item)
      }));
      
      // Add only unique items
      const seenIds = new Set(uniqueItems.map(item => item.uniqueId));
      
      randomWithIds.forEach(item => {
        if (!seenIds.has(item.uniqueId)) {
          seenIds.add(item.uniqueId);
          uniqueItems.push(item);
        }
      });
    }

    // Skip items based on page
    const paginatedItems = paginateItems(uniqueItems, page, limit);

    return paginatedItems
  } catch (error) {
    console.error('Error in getMostPopularContent:', error)
    return getRandomRecommendations(page, limit)
  }
}

/**
 * Get random recommendations when no watch history or popular content is available
 * 
 * @param {number} page - The page number for pagination (0-based)
 * @param {number} limit - The number of items to return per page
 * @returns {Promise<Array>} Array of random content items
 */
async function getRandomRecommendations(page = 0, limit = 30) {
  try {
    const client = await clientPromise
    const db = client.db('Media')
    
    // Get total counts first to know how many items are available
    const [totalMovies, totalTVShows] = await Promise.all([
      db.collection('Movies').countDocuments({}),
      db.collection('TV').countDocuments({})
    ])
    
    console.log(`Total available: ${totalMovies} movies and ${totalTVShows} TV shows`)
    
    // Calculate how many items to fetch - use a larger number to ensure we have enough
    // We'll fetch up to 500 items of each type, which should be enough for most cases
    // while still being efficient
    const fetchLimit = Math.min(500, Math.max(100, limit * 5))
    
    // Fetch random movies and TV shows with skip for pagination
    // Use skip with a random sort to get different items for each page
    const [randomMovies, randomTVShows] = await Promise.all([
      db.collection('Movies')
        .find({})
        .sort({ title: 1 }) // Consistent sort for pagination
        .skip(page * Math.ceil(limit / 2))
        .limit(fetchLimit)
        .toArray(),
      db.collection('TV')
        .find({})
        .sort({ title: 1 }) // Consistent sort for pagination
        .skip(page * Math.ceil(limit / 2))
        .limit(fetchLimit)
        .toArray()
    ])
    
    // Process random TV shows to recommend first episodes
    const processedRandomTVShows = randomTVShows.map(show => {
      const firstEpisodeInfo = findFirstEpisode(show);
      
      if (firstEpisodeInfo) {
        return {
          ...show,
          type: 'tv',
          episode: firstEpisodeInfo.episode,
          seasonNumber: firstEpisodeInfo.seasonNumber,
          isNewShow: true
        };
      }
      
      return null;
    }).filter(Boolean); // Remove null entries
    
    // Remove logo field if it exists
    randomMovies.forEach(movie => {
      if (movie.logo) delete movie.logo
    })
    
    processedRandomTVShows.forEach(show => {
      if (show.logo) delete show.logo
    })
    
    // Process random movies and TV shows
    let [processedMovies, processedTVShows] = await Promise.all([
      addCustomUrlToMedia(randomMovies, 'movie'),
      addCustomUrlToMedia(processedRandomTVShows, 'tv')
    ])
    
    // Filter out any items that don't have valid URLs or required fields
    processedMovies = filterValidItems(processedMovies);
    processedTVShows = filterValidItems(processedTVShows);
    
    // Create a unique ID for each item to ensure we don't have duplicates
    let combined = [...processedMovies, ...processedTVShows].map(item => ({
      ...item,
      uniqueId: generateUniqueId(item)
    }));
    
    // Remove any duplicates based on uniqueId
    const uniqueItems = removeDuplicates(combined);
    
    // Sort deterministically
    uniqueItems.sort((a, b) => {
      // First sort by type to group movies and TV shows
      if (a.type !== b.type) {
        return a.type === 'movie' ? -1 : 1;
      }
      
      // Then sort by title for consistent ordering
      return a.title.localeCompare(b.title);
    });
    
    // Calculate total needed for this page
    const totalNeeded = (page + 1) * limit;
    
    // If we don't have enough items for the requested page, log it
    if (uniqueItems.length < totalNeeded) {
      console.log(`Not enough random items (${uniqueItems.length}) for page ${page}, returning available items`);
    }
    
    // Skip items based on page
    return paginateItems(uniqueItems, page, limit);
  } catch (error) {
    console.error('Error in getRandomRecommendations:', error)
    return []
  }
}

/**
 * Get the latest watch timestamp for a user
 * 
 * @param {string} userId - The user ID to get the latest watch timestamp for
 * @returns {Promise<string>} The latest watch timestamp as a string
 */
async function getLatestWatchTimestamp(userId) {
  try {
    const client = await clientPromise
    const db = client.db('Media')
    
    const userPlayback = await db
      .collection('PlaybackStatus')
      .findOne({ userId: new ObjectId(userId) })
    
    if (!userPlayback || !userPlayback.videosWatched || userPlayback.videosWatched.length === 0) {
      return 'no-watch-history'
    }
    
    // Find the most recent lastUpdated timestamp
    let latestTimestamp = new Date(0) // Start with epoch time
    
    userPlayback.videosWatched.forEach(video => {
      if (video.lastUpdated && new Date(video.lastUpdated) > latestTimestamp) {
        latestTimestamp = new Date(video.lastUpdated)
      }
    })
    
    return latestTimestamp.toISOString()
  } catch (error) {
    console.error('Error getting latest watch timestamp:', error)
    return 'error-getting-timestamp'
  }
}

/**
 * Get recommendations for a user, falling back to popular content if needed
 * 
 * @param {string} userId - The user ID to get recommendations for
 * @param {number} page - The page number for pagination (0-based)
 * @param {number} limit - The number of items to return per page
 * @param {boolean} countOnly - Whether to only return the count of items
 * @returns {Promise<Object>} Object containing recommendations data
 */
export async function getRecommendations(userId, page = 0, limit = 30, countOnly = false) {
  try {
    // Get the latest watch timestamp for this user
    const latestWatchTimestamp = await getLatestWatchTimestamp(userId)
    
    // Create a cache key based on userId, latest watch timestamp, and pagination
    const cacheKey = `${userId}-${latestWatchTimestamp}-${page}-${limit}`
    
    // Check if we have cached recommendations for this user with this watch timestamp
    if (recommendationsCache.has(cacheKey)) {
      const cachedData = recommendationsCache.get(cacheKey)
      console.log(`Using cached recommendations for user ${userId} with timestamp ${latestWatchTimestamp}`)
      
      // For count-only requests
      if (countOnly) {
        return { count: cachedData.items.length }
      }
      
      return cachedData
    }
    
    // Get recommendations based on user's watch history
    const recommendations = await getGenreBasedRecommendations(userId, page, limit)
    
    // If user has no watch history or we couldn't find genre-based recommendations,
    // fall back to most popular content
    let items = recommendations.items
    let hasWatched = recommendations.hasWatched
    
    if (!hasWatched || items.length === 0) {
      items = await getMostPopularContent(page, limit)
      hasWatched = false
    }

    // Get client and db for database operations
    const client = await clientPromise
    const db = client.db('Media')
    
    // Get total counts to know how many pages are available
    const [totalMovies, totalTVShows] = await Promise.all([
      db.collection('Movies').countDocuments({}),
      db.collection('TV').countDocuments({})
    ])
    
    // Calculate total pages based on the total number of items and limit
    // We need to account for filtering, so we use a more conservative estimate
    // to ensure we have enough pages
    const totalItems = Math.min(totalMovies + totalTVShows, 500) // Cap at 500 to avoid excessive pagination
    const totalPages = Math.max(Math.ceil(totalItems / limit), 5) // Ensure at least 5 pages
    
    // Ensure all items have the necessary properties for PopupCard component
    const enhancedItems = items.map(item => ensureMediaProperties(item));
    
    // Cache the recommendations with the latest watch timestamp and pagination metadata
    const result = {
      items: enhancedItems,
      hasWatched,
      genres: recommendations.genres || [],
      latestWatchTimestamp,
      pagination: {
        currentPage: page,
        totalPages,
        totalItems,
        itemsPerPage: limit
      }
    }
    
    // Only cache the current page results
    recommendationsCache.set(cacheKey, result)
    
    // For count-only requests
    if (countOnly) {
      return { count: items.length }
    }

    return result
  } catch (error) {
    console.error('Error in getRecommendations:', error)
    return { items: [], hasWatched: false, error: error.message }
  }
}

// Export all utility functions for use elsewhere
export {
  // Utils
  filterValidEpisodes,
  generateUniqueId,
  removeDuplicates,
  findNextEpisode,
  findFirstEpisode,
  paginateItems,
  
  // Scoring
  calculateRecencyScore,
  calculateGenreSimilarity,
  calculatePopularityScore,
  sortRecommendationsByScore,
  addDiversity,
  
  // Filtering
  filterValidItems,
  filterUnwatchedItems,
  filterByGenres,
  filterTrendingContent
}
