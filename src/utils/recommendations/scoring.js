/**
 * Scoring functions for the recommendation system
 */

/**
 * Calculate a recency score based on timestamp
 * @param {string|Date} timestamp - Timestamp to calculate recency from
 * @param {number} decayFactor - How quickly the score decays with time (higher = faster decay)
 * @returns {number} Recency score between 0 and 1
 */
export function calculateRecencyScore(timestamp, decayFactor = 0.1) {
  if (!timestamp) return 0;
  
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const now = new Date();
  const ageInDays = (now - date) / (1000 * 60 * 60 * 24);
  
  // Exponential decay function: score = e^(-decayFactor * ageInDays)
  return Math.exp(-decayFactor * ageInDays);
}

/**
 * Calculate a completion score based on playback time and total duration
 * @param {number} playbackTime - Current playback time in seconds
 * @param {number} totalDuration - Total duration in seconds
 * @returns {number} Completion score between 0 and 1
 */
export function calculateCompletionScore(playbackTime, totalDuration) {
  if (!playbackTime || !totalDuration || totalDuration <= 0) return 0;
  
  const ratio = playbackTime / totalDuration;
  
  // Favor content that's been watched to completion or near-completion
  if (ratio >= 0.9) return 1;
  
  // Penalize content that was barely started
  if (ratio < 0.1) return 0.2;
  
  // Linear score for content watched partially
  return ratio;
}

/**
 * Calculate genre similarity between user preferences and content
 * @param {Array} userGenres - Array of user's preferred genres
 * @param {Array} contentGenres - Array of content's genres
 * @returns {number} Similarity score between 0 and 1
 */
export function calculateGenreSimilarity(userGenres, contentGenres) {
  if (!userGenres || !contentGenres || !Array.isArray(userGenres) || !Array.isArray(contentGenres)) {
    return 0;
  }
  
  if (userGenres.length === 0 || contentGenres.length === 0) {
    return 0;
  }
  
  // Convert arrays to Sets for faster lookup
  const userGenreSet = new Set(userGenres);
  const contentGenreSet = new Set(contentGenres);
  
  // Count matching genres
  let matchCount = 0;
  contentGenreSet.forEach(genre => {
    if (userGenreSet.has(genre)) {
      matchCount++;
    }
  });
  
  // Calculate Jaccard similarity: intersection size / union size
  const unionSize = userGenreSet.size + contentGenreSet.size - matchCount;
  return unionSize > 0 ? matchCount / unionSize : 0;
}

/**
 * Calculate a diversity score to promote content exploration
 * @param {string} itemId - ID of the item to score
 * @param {Array} recentlyWatchedIds - Array of recently watched item IDs
 * @returns {number} Diversity score between 0 and 1
 */
export function calculateDiversityScore(itemId, recentlyWatchedIds) {
  if (!itemId || !recentlyWatchedIds || !Array.isArray(recentlyWatchedIds)) {
    return 1; // Default to high diversity if we can't calculate
  }
  
  // If the item is in recently watched, it has low diversity
  if (recentlyWatchedIds.includes(itemId)) {
    return 0.2;
  }
  
  // Otherwise, it's diverse content
  return 1;
}

/**
 * Calculate a popularity score based on watch count
 * @param {number} watchCount - Number of times the content has been watched
 * @param {number} maxWatchCount - Maximum watch count for normalization
 * @returns {number} Popularity score between 0 and 1
 */
export function calculatePopularityScore(watchCount, maxWatchCount = 100) {
  if (!watchCount || watchCount <= 0) return 0;
  
  // Normalize watch count to a 0-1 scale
  return Math.min(watchCount / maxWatchCount, 1);
}

/**
 * Calculate a multi-factor recommendation score
 * @param {Object} params - Parameters for score calculation
 * @returns {number} Final recommendation score between 0 and 1
 */
export function calculateRecommendationScore({
  genreSimilarity = 0,
  recency = 0,
  completion = 0,
  popularity = 0,
  diversity = 1,
  isNextEpisode = false,
  weights = {
    genreSimilarity: 0.3,
    recency: 0.2,
    completion: 0.15,
    popularity: 0.15,
    diversity: 0.1,
    nextEpisode: 0.5
  }
}) {
  // Calculate weighted score
  let score = (
    (genreSimilarity * weights.genreSimilarity) +
    (recency * weights.recency) +
    (completion * weights.completion) +
    (popularity * weights.popularity) +
    (diversity * weights.diversity)
  );
  
  // Boost score for next episodes
  if (isNextEpisode) {
    score += weights.nextEpisode;
  }
  
  // Normalize to 0-1 range
  return Math.min(Math.max(score, 0), 1);
}

/**
 * Sort recommendations by a multi-factor score
 * @param {Array} recommendations - Array of recommendation items
 * @param {Object} userPreferences - User preference data
 * @returns {Array} Sorted recommendations
 */
export function sortRecommendationsByScore(recommendations, userPreferences = {}) {
  if (!recommendations || !Array.isArray(recommendations)) return [];
  
  // Clone the array to avoid modifying the original
  const sortedRecs = [...recommendations];
  
  // Extract user preferences
  const userGenres = userPreferences.genres || [];
  const recentlyWatchedIds = userPreferences.recentlyWatchedIds || [];
  
  // Calculate scores for each item
  sortedRecs.forEach(item => {
    // Extract relevant data for scoring
    const genreSimilarity = item.metadata && item.metadata.genres
      ? calculateGenreSimilarity(userGenres, item.metadata.genres.map(g => g.id || g.name))
      : 0;
    
    const recency = item.lastUpdated
      ? calculateRecencyScore(item.lastUpdated)
      : 0;
    
    const popularity = item.watchCount
      ? calculatePopularityScore(item.watchCount)
      : 0;
    
    const diversity = item._id
      ? calculateDiversityScore(item._id.toString(), recentlyWatchedIds)
      : 1;
    
    const isNextEpisode = !!item.isNextEpisode;
    
    // Calculate final score
    item.score = calculateRecommendationScore({
      genreSimilarity,
      recency,
      popularity,
      diversity,
      isNextEpisode
    });
  });
  
  // Sort by score (descending)
  return sortedRecs.sort((a, b) => b.score - a.score);
}

/**
 * Add diversity to recommendations by including some items outside user preferences
 * @param {Array} personalizedRecs - Personalized recommendations
 * @param {Array} diverseRecs - More diverse recommendations
 * @param {number} diversityRatio - Ratio of diverse items to include (0-1)
 * @returns {Array} Mixed recommendations with diversity
 */
export function addDiversity(personalizedRecs, diverseRecs, diversityRatio = 0.2) {
  if (!personalizedRecs || !Array.isArray(personalizedRecs)) return diverseRecs || [];
  if (!diverseRecs || !Array.isArray(diverseRecs)) return personalizedRecs;
  
  const totalItems = personalizedRecs.length;
  const diverseCount = Math.round(totalItems * diversityRatio);
  const personalizedCount = totalItems - diverseCount;
  
  // Take top personalized recommendations
  const topPersonalized = personalizedRecs.slice(0, personalizedCount);
  
  // Take diverse recommendations not already in personalized set
  const personalizedIds = new Set(topPersonalized.map(item => item.uniqueId));
  const uniqueDiverse = diverseRecs.filter(item => !personalizedIds.has(item.uniqueId))
    .slice(0, diverseCount);
  
  // Combine and shuffle slightly to distribute diverse items
  const combined = [...topPersonalized, ...uniqueDiverse];
  
  // Simple deterministic shuffle that keeps top items mostly at the top
  // but distributes diverse items throughout
  for (let i = personalizedCount; i < combined.length; i++) {
    const swapIndex = Math.floor(i * 0.7); // This distributes diverse items but keeps them mostly in the latter portion
    if (swapIndex < i) {
      const temp = combined[i];
      combined[i] = combined[swapIndex];
      combined[swapIndex] = temp;
    }
  }
  
  return combined;
}
