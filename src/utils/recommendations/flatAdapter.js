'use server'

import {
  getFlatGenreBasedRecommendations,
  getFlatMostPopularContent,
  getFlatRecommendations,
  getFlatRandomRecommendations
} from '@src/utils/flatRecommendations'

import {
  getGenreBasedRecommendations,
  getMostPopularContent,
  getRecommendations,
  getRandomRecommendations
} from './index'

/**
 * Adapter that uses flat database functions if available, falling back to original functions.
 * This allows for a smooth transition between the database structures.
 */

/**
 * Check if the environment is configured to use the flat database.
 * @returns {boolean} True if flat database should be used, false otherwise.
 */
function shouldUseFlatDatabase() {
  // This could be a config setting or environment variable
  return true; // For now, always use flat database
}

/**
 * Get genre-based recommendations with appropriate database structure.
 * @param {string} userId - The user ID to get recommendations for
 * @param {number} page - The page number for pagination (0-based)
 * @param {number} limit - The number of items per page
 * @returns {Promise<Object>} Object containing hasWatched flag, recommended items, and genre info
 */
export async function getAdaptedGenreBasedRecommendations(userId, page = 0, limit = 30) {
  try {
    if (shouldUseFlatDatabase()) {
      return await getFlatGenreBasedRecommendations(userId, page, limit);
    } else {
      return await getGenreBasedRecommendations(userId, page, limit);
    }
  } catch (error) {
    console.error('Error in getAdaptedGenreBasedRecommendations:', error);
    
    // If flat database fails, try original function as fallback
    if (shouldUseFlatDatabase()) {
      console.log('Falling back to original database structure');
      try {
        return await getGenreBasedRecommendations(userId, page, limit);
      } catch (fallbackError) {
        console.error('Fallback also failed:', fallbackError);
        return { hasWatched: false, items: [], error: fallbackError.message };
      }
    }
    
    return { hasWatched: false, items: [], error: error.message };
  }
}

/**
 * Get most popular content with appropriate database structure.
 * @param {number} page - The page number for pagination (0-based)
 * @param {number} limit - The number of items per page
 * @returns {Promise<Array>} Array of popular content items
 */
export async function getAdaptedMostPopularContent(page = 0, limit = 30) {
  try {
    if (shouldUseFlatDatabase()) {
      return await getFlatMostPopularContent(page, limit);
    } else {
      return await getMostPopularContent(page, limit);
    }
  } catch (error) {
    console.error('Error in getAdaptedMostPopularContent:', error);
    
    // If flat database fails, try original function as fallback
    if (shouldUseFlatDatabase()) {
      console.log('Falling back to original database structure');
      try {
        return await getMostPopularContent(page, limit);
      } catch (fallbackError) {
        console.error('Fallback also failed:', fallbackError);
        return [];
      }
    }
    
    return [];
  }
}

/**
 * Get random recommendations with appropriate database structure.
 * @param {number} page - The page number for pagination (0-based)
 * @param {number} limit - The number of items per page
 * @returns {Promise<Array>} Array of random content items
 */
export async function getAdaptedRandomRecommendations(page = 0, limit = 30) {
  try {
    if (shouldUseFlatDatabase()) {
      return await getFlatRandomRecommendations(page, limit);
    } else {
      throw new Error('Original random recommendations function not exported');
    }
  } catch (error) {
    console.error('Error in getAdaptedRandomRecommendations:', error);
    return [];
  }
}

/**
 * Get recommendations for a user with appropriate database structure.
 * @param {string} userId - The user ID to get recommendations for
 * @param {number} page - The page number for pagination (0-based)
 * @param {number} limit - The number of items per page
 * @param {boolean} countOnly - Whether to only return the count of items
 * @returns {Promise<Object>} Object containing recommendations data
 */
export async function getAdaptedRecommendations(userId, page = 0, limit = 30, countOnly = false) {
  try {
    if (shouldUseFlatDatabase()) {
      return await getFlatRecommendations(userId, page, limit, countOnly);
    } else {
      return await getRecommendations(userId, page, limit, countOnly);
    }
  } catch (error) {
    console.error('Error in getAdaptedRecommendations:', error);
    
    // If flat database fails, try original function as fallback
    if (shouldUseFlatDatabase()) {
      console.log('Falling back to original database structure');
      try {
        return await getRecommendations(userId, page, limit, countOnly);
      } catch (fallbackError) {
        console.error('Fallback also failed:', fallbackError);
        return { items: [], hasWatched: false, error: fallbackError.message };
      }
    }
    
    return { items: [], hasWatched: false, error: error.message };
  }
}
