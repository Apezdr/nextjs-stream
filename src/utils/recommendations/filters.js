/**
 * Filtering functions for the recommendation system
 */

/**
 * Filter out items that don't have required fields
 * @param {Array} items - Array of media items
 * @returns {Array} Filtered array of valid items
 */
export function filterValidItems(items) {
  if (!items || !Array.isArray(items)) return [];
  
  return items.filter(item => {
    if (!item) return false;
    
    // Common required fields for all media types
    if (!item.posterURL || !item.title || !item.id) return false;
    
    // Additional requirements for TV shows
    if (item.type === 'tv' && (!item.episode || !item.seasonNumber)) return false;
    
    return true;
  });
}

/**
 * Filter out items that the user has already watched completely
 * @param {Array} items - Array of media items
 * @param {Set} watchedVideoURLs - Set of watched video URLs
 * @param {Object} options - Additional options
 * @returns {Array} Filtered array of unwatched items
 */
export function filterUnwatchedItems(items, watchedVideoURLs, options = { completionThreshold: 0.9 }) {
  if (!items || !Array.isArray(items) || !watchedVideoURLs) return items || [];
  
  return items.filter(item => {
    // For movies, check if the videoURL is in the watched set
    if (item.type === 'movie' && item.videoURL) {
      // If the movie is in the watched set, check if it's been watched to completion
      if (watchedVideoURLs.has(item.videoURL)) {
        // If we have playback data, check if it's been watched to completion
        const watchedItem = Array.from(watchedVideoURLs.entries())
          .find(([url, data]) => url === item.videoURL);
        
        if (watchedItem && watchedItem[1] && watchedItem[1].playbackTime && item.duration) {
          const completionRatio = watchedItem[1].playbackTime / item.duration;
          return completionRatio < options.completionThreshold;
        }
        
        // If we don't have detailed playback data, assume it's been watched
        return false;
      }
      
      // Not in watched set, so it's unwatched
      return true;
    }
    
    // For TV shows, it's more complex - we need to check if all episodes have been watched
    if (item.type === 'tv' && item.episode && item.episode.videoURL) {
      // If this specific episode has been watched, filter it out
      return !watchedVideoURLs.has(item.episode.videoURL);
    }
    
    // Default to including the item if we can't determine watch status
    return true;
  });
}

/**
 * Filter items to only include those matching specified genres
 * @param {Array} items - Array of media items
 * @param {Array} genres - Array of genre IDs to filter by
 * @returns {Array} Filtered array of items matching genres
 */
export function filterByGenres(items, genres) {
  if (!items || !Array.isArray(items) || !genres || !Array.isArray(genres) || genres.length === 0) {
    return items || [];
  }
  
  return items.filter(item => {
    if (!item.metadata || !item.metadata.genres || !Array.isArray(item.metadata.genres)) {
      return false;
    }
    
    // Check if any of the item's genres match the filter genres
    return item.metadata.genres.some(genre => {
      const genreId = genre.id || genre.name;
      return genres.includes(genreId);
    });
  });
}

/**
 * Filter items to only include those with a minimum score
 * @param {Array} items - Array of media items with scores
 * @param {number} minScore - Minimum score threshold (0-1)
 * @returns {Array} Filtered array of items meeting the score threshold
 */
export function filterByMinimumScore(items, minScore = 0.3) {
  if (!items || !Array.isArray(items)) return [];
  
  return items.filter(item => {
    // If the item has no score, give it a default score of 0
    const score = item.score !== undefined ? item.score : 0;
    return score >= minScore;
  });
}

/**
 * Filter items to exclude those in a blacklist
 * @param {Array} items - Array of media items
 * @param {Array} blacklistIds - Array of item IDs to exclude
 * @returns {Array} Filtered array excluding blacklisted items
 */
export function filterExcludeBlacklist(items, blacklistIds) {
  if (!items || !Array.isArray(items)) return [];
  if (!blacklistIds || !Array.isArray(blacklistIds) || blacklistIds.length === 0) return items;
  
  // Convert blacklist to a Set for faster lookups
  const blacklistSet = new Set(blacklistIds);
  
  return items.filter(item => {
    if (!item._id) return true;
    return !blacklistSet.has(item._id.toString());
  });
}

/**
 * Filter out items with invalid video URLs
 * @param {Array} items - Array of media items
 * @param {Set} watchedVideoURLs - Set of watched video URLs with metadata
 * @returns {Array} Filtered array of items with valid video URLs
 */
export function filterValidVideoUrls(items, watchedVideoURLs) {
  if (!items || !Array.isArray(items) || !watchedVideoURLs) return items || [];
  
  return items.filter(item => {
    // For movies, check if the videoURL is valid
    if (item.type === 'movie' && item.videoURL) {
      if (watchedVideoURLs.has(item.videoURL)) {
        const watchedItem = Array.from(watchedVideoURLs.entries())
          .find(([url, data]) => url === item.videoURL);
        
        // If the video is explicitly marked as invalid, filter it out
        if (watchedItem && watchedItem[1] && watchedItem[1].isValid === false) {
          return false;
        }
      }
      
      // If not in watched set or not explicitly invalid, keep it
      return true;
    }
    
    // For TV shows, check if the episode videoURL is valid
    if (item.type === 'tv' && item.episode && item.episode.videoURL) {
      if (watchedVideoURLs.has(item.episode.videoURL)) {
        const watchedItem = Array.from(watchedVideoURLs.entries())
          .find(([url, data]) => url === item.episode.videoURL);
        
        // If the video is explicitly marked as invalid, filter it out
        if (watchedItem && watchedItem[1] && watchedItem[1].isValid === false) {
          return false;
        }
      }
      
      // If not in watched set or not explicitly invalid, keep it
      return true;
    }
    
    // Default to including the item if we can't determine validity
    return true;
  });
}

/**
 * Filter items to only include trending content
 * @param {Array} items - Array of media items
 * @param {number} trendingThreshold - Minimum watch count to be considered trending
 * @param {number} recentDays - Number of days to consider for recency
 * @returns {Array} Filtered array of trending items
 */
export function filterTrendingContent(items, trendingThreshold = 10, recentDays = 30) {
  if (!items || !Array.isArray(items)) return [];
  
  const now = new Date();
  const recentThreshold = new Date(now.getTime() - (recentDays * 24 * 60 * 60 * 1000));
  
  return items.filter(item => {
    // Check if the item has a watch count above the threshold
    const hasHighWatchCount = item.watchCount && item.watchCount >= trendingThreshold;
    
    // Check if the item is recent
    let isRecent = false;
    if (item.lastUpdated) {
      const lastUpdated = new Date(item.lastUpdated);
      isRecent = lastUpdated >= recentThreshold;
    }
    
    // Item is trending if it has a high watch count and is recent
    return hasHighWatchCount && isRecent;
  });
}
