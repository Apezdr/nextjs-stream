'use server'

// Import all functionality from the modular recommendation engine
import {
  getGenreBasedRecommendations,
  getMostPopularContent,
  getRecommendations
} from './recommendations/index'

/**
 * Re-export the main recommendation functions
 */
export {
  getGenreBasedRecommendations,
  getMostPopularContent,
  getRecommendations
}

// This file now serves as a compatibility layer for the new modular recommendation engine.
// All functionality has been moved to the recommendations/ directory for better organization
// and maintainability.
