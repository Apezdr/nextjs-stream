import clientPromise from '@src/lib/mongodb'
import { ObjectId } from 'mongodb'
import { addCustomUrlToFlatMedia } from '@src/utils/flatDatabaseUtils'
import { sanitizeRecord } from '@src/utils/auth_utils'

// Import utility functions
import {
  filterValidEpisodes,
  generateUniqueId,
  removeDuplicates,
  findFlatNextEpisode,
  findFlatFirstEpisode,
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
} from '@src/utils/recommendations/scoring'

// Import filtering functions
import {
  filterValidItems,
  filterUnwatchedItems,
  filterByGenres,
  filterTrendingContent,
  filterValidVideoUrls
} from '@src/utils/recommendations/filters'

/**
 * Get genre-based recommendations for a user based on their watch history, using flat database structure
 * 
 * @param {string} userId - The user ID to get recommendations for
 * @param {number} page - The page number for pagination (0-based)
 * @param {number} limit - The number of items to return per page
 * @returns {Promise<Object>} Object containing hasWatched flag, recommended items, and genre info
 */
export async function getFlatGenreBasedRecommendations(userId, page = 0, limit = 30) {
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

    // Find movies and episodes using flat database structure
    const [watchedMovies, watchedEpisodes] = await Promise.all([
      db.collection('FlatMovies')
        .find({ videoURL: { $in: videoIds } })
        .toArray(),
      db.collection('FlatEpisodes')
        .find({ videoURL: { $in: videoIds } })
        .toArray()
    ])

    // For episodes, we need to fetch their seasons and shows
    const watchedTVShows = new Map(); // Map of TV show ID to show object
    
    // First get all the unique show IDs from the episodes
    const showIds = [...new Set(watchedEpisodes.map(episode => episode.showId.toString()))];
    
    // Fetch all shows at once
    const tvShows = await db.collection('FlatTVShows')
      .find({ _id: { $in: showIds.map(id => new ObjectId(id)) } })
      .toArray();
    
    // Create a map of shows by ID for quick lookups
    const tvShowsMap = new Map(tvShows.map(show => [show._id.toString(), show]));
    
    // Group episodes by show ID
    for (const episode of watchedEpisodes) {
      const showId = episode.showId.toString();
      const show = tvShowsMap.get(showId);
      
      if (!show) continue; // Skip if show not found
      
      if (!watchedTVShows.has(showId)) {
        watchedTVShows.set(showId, {
          ...show,
          episodes: []
        });
      }
      
      // Add episode to the show
      watchedTVShows.get(showId).episodes.push(episode);
    }

    if (watchedMovies.length === 0 && watchedTVShows.size === 0) {
      return { hasWatched: false, items: [] }
    }

    // Log for debugging
    console.log(`Found ${watchedMovies.length} watched movies and ${watchedTVShows.size} watched TV shows for user ${userId}`)

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
    watchedTVShows.forEach((show) => {
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
    
    // Create a set of watched TV show IDs
    const watchedTVShowIds = new Set(Array.from(watchedTVShows.keys()));

    // Get total counts to know how many items are available
    const [totalMovies, totalTVShows] = await Promise.all([
      db.collection('FlatMovies').countDocuments({}),
      db.collection('FlatTVShows').countDocuments({})
    ])
    
    console.log(`Total available for genre recommendations: ${totalMovies} movies and ${totalTVShows} TV shows`)
    
    // Calculate how many items to fetch - use a larger number to ensure we have enough
    const fetchLimit = Math.min(500, Math.max(100, limit * 5))

    // Query for unwatched movies with matching genres
    const movieQuery = {
      '_id': { $nin: Array.from(watchedMovieIds).map(id => new ObjectId(id)) },
      'metadata.genres.id': { $in: sortedGenres }
    }

    // Fetch movie recommendations with pagination
    const recommendedMovies = await db.collection('FlatMovies')
      .find(movieQuery)
      .sort({ title: 1 }) // Consistent sort for pagination
      .skip(page * Math.ceil(limit / 2))
      .limit(fetchLimit)
      .toArray()

    // Process TV show recommendations - we need to find next episodes for watched shows
    // and new shows with matching genres
    const tvRecommendations = []
    
    // 1. First, find next episodes for shows the user has already started watching
    for (const [showId, showData] of watchedTVShows) {
      // First get all seasons for this show
      const showSeasons = await db.collection('FlatSeasons')
        .find({ showId: new ObjectId(showId) })
        .sort({ seasonNumber: 1 })
        .toArray();
        
      // Add seasons to the show object
      showData.seasons = showSeasons;
      
      // For each season, get its episodes
      for (const season of showSeasons) {
        season.episodes = await db.collection('FlatEpisodes')
          .find({ seasonId: season._id })
          .sort({ episodeNumber: 1 })
          .toArray();
      }
      
      // Find the next episode for this show
      const nextEpisodeInfo = findFlatNextEpisode(showData, watchedVideoURLs);
      
      // If we found a next episode, add it to recommendations
      if (nextEpisodeInfo) {
        tvRecommendations.push({
          ...showData,
          type: 'tv',
          episode: nextEpisodeInfo.episode,
          seasonNumber: nextEpisodeInfo.seasonNumber,
          episodeNumber: nextEpisodeInfo.episodeNumber,
          isNextEpisode: true,
          // Explicitly include the episode data needed for media endpoint
          link: `${encodeURIComponent(showData.title)}/${nextEpisodeInfo.seasonNumber}/${nextEpisodeInfo.episodeNumber}`,
          mediaId: showData._id.toString(),
          title: showData.title
        });
      }
    }
    
    // 2. If we need more recommendations, find new shows with matching genres
    if (tvRecommendations.length < Math.ceil(limit / 2)) {
      // How many more TV shows we need
      const remainingTVShows = Math.ceil(limit / 2) - tvRecommendations.length
      
      // Query for unwatched TV shows with matching genres
      const tvQuery = {
        '_id': { $nin: Array.from(watchedTVShowIds).map(id => new ObjectId(id)) },
        'metadata.genres.id': { $in: sortedGenres }
      }
      
      const newTVShows = await db.collection('FlatTVShows')
        .find(tvQuery)
        .limit(remainingTVShows)
        .toArray()
      
      // For each new show, recommend the first episode of the first season
      for (const show of newTVShows) {
        // Get all seasons for this show
        const showSeasons = await db.collection('FlatSeasons')
          .find({ showId: show._id })
          .sort({ seasonNumber: 1 })
          .toArray();
          
        // Skip if no seasons found
        if (showSeasons.length === 0) continue;
        
        // Add seasons to the show object
        show.seasons = showSeasons;
        
        // Get episodes for the first season
        const firstSeason = showSeasons[0];
        firstSeason.episodes = await db.collection('FlatEpisodes')
          .find({ seasonId: firstSeason._id })
          .sort({ episodeNumber: 1 })
          .toArray();
          
        // Skip if no episodes found
        if (firstSeason.episodes.length === 0) continue;
        
        const firstEpisodeInfo = findFlatFirstEpisode(show);
        
        if (firstEpisodeInfo) {
          tvRecommendations.push({
            ...show,
            type: 'tv',
            episode: firstEpisodeInfo.episode,
            seasonNumber: firstEpisodeInfo.seasonNumber,
            episodeNumber: firstEpisodeInfo.episode.episodeNumber,
            isNewShow: true,
            // Explicitly include the episode data needed for media endpoint
            link: `${encodeURIComponent(show.title)}/${firstEpisodeInfo.seasonNumber}/${firstEpisodeInfo.episode.episodeNumber}`,
            mediaId: show._id.toString(),
            title: show.title
          });
        }
      }
    }

    // Remove logo field if it exists
    recommendedMovies.forEach(movie => {
      if (movie.logo) delete movie.logo
    })
    
    tvRecommendations.forEach(show => {
      if (!show.episode) {
        if (show.logo) delete show.logo
      }
    })

    // Process movies and TV shows to add necessary fields
    let [processedMovies, processedTVShows] = await Promise.all([
      addCustomUrlToFlatMedia(recommendedMovies, 'movie'),
      addCustomUrlToFlatMedia(tvRecommendations, 'tv')
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
      const randomRecommendations = await getFlatRandomRecommendations(page, remainingItems)
      
      // Add random recommendations to the list
      recommendations = [...recommendations, ...randomRecommendations]
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
        Array.from(watchedTVShowIds)
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
    console.error('Error in getFlatGenreBasedRecommendations:', error)
    return { hasWatched: false, items: [], error: error.message }
  }
}

/**
 * Get most popular content based on watch counts, using flat database structure
 * 
 * @param {number} page - The page number for pagination (0-based)
 * @param {number} limit - The number of items to return per page
 * @returns {Promise<Array>} Array of popular content items
 */
export async function getFlatMostPopularContent(page = 0, limit = 30) {
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
      return getFlatRandomRecommendations(page, limit)
    }
    
    // Find corresponding movies and episodes in flat database
    const [movies, episodes] = await Promise.all([
      db.collection('FlatMovies').find({ videoURL: { $in: allVideoIds } }).toArray(),
      db.collection('FlatEpisodes').find({ videoURL: { $in: allVideoIds } }).toArray()
    ])

    if (movies.length === 0 && episodes.length === 0) {
      // If no watch data, just return some random movies and TV shows
      return getFlatRandomRecommendations(page, limit)
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

    // Group TV episodes by show ID
    const tvShowPopularity = new Map() // Map of show ID to total watch count
    const tvShowEpisodes = new Map() // Map of show ID to episodes
    
    // First gather all show IDs from the episodes
    const showIds = [...new Set(episodes.map(episode => episode.showId.toString()))];
    
    // Fetch all TV shows and seasons at once
    const [tvShows, seasons] = await Promise.all([
      db.collection('FlatTVShows').find({ _id: { $in: showIds.map(id => new ObjectId(id)) } }).toArray(),
      db.collection('FlatSeasons').find({ showId: { $in: showIds.map(id => new ObjectId(id)) } }).toArray()
    ]);
    
    // Create maps for quick lookups
    const tvShowsMap = new Map(tvShows.map(show => [show._id.toString(), show]));
    const seasonsMap = new Map();
    
    // Group seasons by show ID
    seasons.forEach(season => {
      const showId = season.showId.toString();
      if (!seasonsMap.has(showId)) {
        seasonsMap.set(showId, []);
      }
      seasonsMap.get(showId).push(season);
    });
    
    // Process episodes
    episodes.forEach(episode => {
      const showId = episode.showId.toString();
      const show = tvShowsMap.get(showId);
      
      if (!show) return; // Skip if show not found
      
      if (episode.videoURL && watchCountMap.has(episode.videoURL)) {
        const watchCount = watchCountMap.get(episode.videoURL) || 0;
        
        // Initialize show data if not already present
        if (!tvShowPopularity.has(showId)) {
          tvShowPopularity.set(showId, {
            show,
            totalWatchCount: 0
          });
        }
        
        // Update total watch count for the show
        tvShowPopularity.get(showId).totalWatchCount += watchCount;
        
        // Store episode data
        if (!tvShowEpisodes.has(showId)) {
          tvShowEpisodes.set(showId, []);
        }
        
        // Find the season for this episode
        const season = seasonsMap.get(showId)?.find(s => s._id.equals(episode.seasonId));
        
        if (season) {
          tvShowEpisodes.get(showId).push({
            episode,
            seasonNumber: season.seasonNumber,
            watchCount
          });
        }
      }
    });
    
    // Sort TV shows by popularity
    const sortedTVShows = [...tvShowPopularity.values()]
      .sort((a, b) => b.totalWatchCount - a.totalWatchCount)
      .slice(0, Math.ceil(limit / 2));
    
    // For each popular show, recommend the first episode
    const tvShowsWithWatchCount = [];
    
    for (const { show } of sortedTVShows) {
      const showId = show._id.toString();
      const episodes = tvShowEpisodes.get(showId) || [];
      
      if (episodes.length > 0) {
        // Get all seasons for this show
        const showSeasons = seasonsMap.get(showId) || [];
        
        // Skip if no seasons found
        if (showSeasons.length === 0) continue;
        
        // Add seasons to the show object
        show.seasons = showSeasons;
        
        // Get episodes for the first season
        const firstSeason = showSeasons.find(s => s.seasonNumber === Math.min(...showSeasons.map(s => s.seasonNumber)));
        
        if (!firstSeason) continue;
        
        // Get episodes for the first season
        firstSeason.episodes = await db.collection('FlatEpisodes')
          .find({ seasonId: firstSeason._id })
          .sort({ episodeNumber: 1 })
          .toArray();
          
        // Skip if no episodes found
        if (firstSeason.episodes.length === 0) continue;
        
        const firstEpisodeInfo = findFlatFirstEpisode(show);
        
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
    }

    // Process with addCustomUrlToFlatMedia
    let [processedMovies, processedTVShows] = await Promise.all([
      addCustomUrlToFlatMedia(moviesWithWatchCount, 'movie'),
      addCustomUrlToFlatMedia(tvShowsWithWatchCount, 'tv')
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
      db.collection('FlatMovies').countDocuments({}),
      db.collection('FlatTVShows').countDocuments({})
    ])
    
    console.log(`Total available for popular content: ${totalMovies} movies and ${totalTVShows} TV shows`)
    
    // If we don't have enough recommendations for the requested page, fetch more random ones
    if (uniqueItems.length < totalNeeded) {
      console.log(`Not enough popular content (${uniqueItems.length}) for page ${page}, fetching random ones`)
      
      // How many more items we need - fetch more than we need to ensure we have enough
      const fetchLimit = Math.min(500, Math.max(100, limit * 5))
      
      // Get random recommendations with pagination
      const randomRecommendations = await getFlatRandomRecommendations(page, fetchLimit)
      
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
    console.error('Error in getFlatMostPopularContent:', error)
    return getFlatRandomRecommendations(page, limit)
  }
}

/**
 * Get random recommendations when no watch history or popular content is available, using flat database
 * 
 * @param {number} page - The page number for pagination (0-based)
 * @param {number} limit - The number of items to return per page
 * @returns {Promise<Array>} Array of random content items
 */
export async function getFlatRandomRecommendations(page = 0, limit = 30) {
  try {
    const client = await clientPromise
    const db = client.db('Media')
    
    // Get total counts first to know how many items are available
    const [totalMovies, totalTVShows] = await Promise.all([
      db.collection('FlatMovies').countDocuments({}),
      db.collection('FlatTVShows').countDocuments({})
    ])
    
    console.log(`Total available: ${totalMovies} movies and ${totalTVShows} TV shows`)
    
    // Calculate how many items to fetch - use a larger number to ensure we have enough
    const fetchLimit = Math.min(500, Math.max(100, limit * 5))
    
    // Fetch random movies and TV shows with skip for pagination
    const [randomMovies, randomTVShows] = await Promise.all([
      db.collection('FlatMovies')
        .find({})
        .sort({ title: 1 }) // Consistent sort for pagination
        .skip(page * Math.ceil(limit / 2))
        .limit(fetchLimit)
        .toArray(),
      db.collection('FlatTVShows')
        .find({})
        .sort({ title: 1 }) // Consistent sort for pagination
        .skip(page * Math.ceil(limit / 2))
        .limit(fetchLimit)
        .toArray()
    ])
    
    // Process random TV shows to recommend first episodes
    const processedRandomTVShows = [];
    
    // For each TV show, find its first episode
    for (const show of randomTVShows) {
      // Get all seasons for this show
      const showSeasons = await db.collection('FlatSeasons')
        .find({ showId: show._id })
        .sort({ seasonNumber: 1 })
        .toArray();
        
      // Skip if no seasons found
      if (showSeasons.length === 0) continue;
      
      // Add seasons to the show object
      show.seasons = showSeasons;
      
      // Get episodes for the first season
      const firstSeason = showSeasons[0];
      firstSeason.episodes = await db.collection('FlatEpisodes')
        .find({ seasonId: firstSeason._id })
        .sort({ episodeNumber: 1 })
        .toArray();
        
      // Skip if no episodes found
      if (firstSeason.episodes.length === 0) continue;
      
      const firstEpisodeInfo = findFlatFirstEpisode(show);
      
      if (firstEpisodeInfo) {
        processedRandomTVShows.push({
          ...show,
          type: 'tv',
          episode: firstEpisodeInfo.episode,
          seasonNumber: firstEpisodeInfo.seasonNumber,
          episodeNumber: firstEpisodeInfo.episode.episodeNumber,
          isNewShow: true,
          // Explicitly include the episode data needed for media endpoint
          link: `${encodeURIComponent(show.title)}/${firstEpisodeInfo.seasonNumber}/${firstEpisodeInfo.episode.episodeNumber}`,
          mediaId: show._id.toString(),
          title: show.title
        });
      }
    };
    
    // Remove logo field if it exists
    randomMovies.forEach(movie => {
      if (movie.logo) delete movie.logo
    })
    
    processedRandomTVShows.forEach(show => {
      if (show.logo) delete show.logo
    })
    
    // Process random movies and TV shows
    let [processedMovies, processedTVShows] = await Promise.all([
      addCustomUrlToFlatMedia(randomMovies, 'movie'),
      addCustomUrlToFlatMedia(processedRandomTVShows, 'tv')
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
    console.error('Error in getFlatRandomRecommendations:', error)
    return []
  }
}

/**
 * Get the latest watch timestamp for a user
 * 
 * @param {string} userId - The user ID to get the latest watch timestamp for
 * @returns {Promise<string>} The latest watch timestamp as a string
 */
async function getFlatLatestWatchTimestamp(userId) {
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
 * Get recommendations for a user, falling back to popular content if needed, using the flat database structure
 * No longer caches between requests to ensure metadata/posters are always up-to-date
 * 
 * @param {string} userId - The user ID to get recommendations for
 * @param {number} page - The page number for pagination (0-based)
 * @param {number} limit - The number of items to return per page
 * @param {boolean} countOnly - Whether to only return the count of items
 * @returns {Promise<Object>} Object containing recommendations data
 */
export async function getFlatRecommendations(userId, page = 0, limit = 30, countOnly = false) {
  try {
    // Get the latest watch timestamp for this user (for logging purposes only)
    const latestWatchTimestamp = await getFlatLatestWatchTimestamp(userId)
    
    // Log timestamp for debugging
    console.log(`Fetching fresh recommendations for user ${userId} with timestamp ${latestWatchTimestamp}`)
    
    // Create a hardcoded context object for recommendations
    const context = { dateContext: 'recommendations' }
    
    // Get recommendations based on user's watch history
    const recommendations = await getFlatGenreBasedRecommendations(userId, page, limit)
    
    // If user has no watch history or we couldn't find genre-based recommendations,
    // fall back to most popular content
    let items = recommendations.items
    let hasWatched = recommendations.hasWatched
    
    if (!hasWatched || items.length === 0) {
      items = await getFlatMostPopularContent(page, limit)
      hasWatched = false
    }

    // Get client and db for database operations
    const client = await clientPromise
    const db = client.db('Media')
    
    // Get total counts to know how many pages are available
    const [totalMovies, totalTVShows] = await Promise.all([
      db.collection('FlatMovies').countDocuments({}),
      db.collection('FlatTVShows').countDocuments({})
    ])
    
    // Calculate total pages based on the total number of items and limit
    // We need to account for filtering, so we use a more conservative estimate
    // to ensure we have enough pages
    const totalItems = Math.min(totalMovies + totalTVShows, 500) // Cap at 500 to avoid excessive pagination
    const totalPages = Math.max(Math.ceil(totalItems / limit), 5) // Ensure at least 5 pages
    
    // Sanitize each item to ensure proper blurhash processing
    // Use the hardcoded context for consistent date field handling
    const sanitizedItems = await Promise.all(
      items.map(item => sanitizeRecord(item, item.type, context))
    );
    
    // Then ensure they have all needed UI properties for PopupCard component
    const enhancedItems = await Promise.all(
      sanitizedItems.filter(Boolean).map(item => ensureMediaProperties(item))
    );
    
    // Create result object with recommendations data (no caching)
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
    
    // For count-only requests
    if (countOnly) {
      return { count: items.length }
    }

    // Return fresh results without caching
    return result
  } catch (error) {
    console.error('Error in getFlatRecommendations:', error)
    return { items: [], hasWatched: false, error: error.message }
  }
}

// Export all utility functions for use elsewhere
export {
  // Utils
  filterValidEpisodes,
  generateUniqueId,
  removeDuplicates,
  findFlatNextEpisode,
  findFlatFirstEpisode,
  paginateItems,
  
  // Scoring functions (re-exported)
  calculateRecencyScore,
  calculateGenreSimilarity,
  calculatePopularityScore,
  sortRecommendationsByScore,
  addDiversity,
  
  // Filtering functions (re-exported)
  filterValidItems,
  filterUnwatchedItems,
  filterByGenres,
  filterTrendingContent
}
