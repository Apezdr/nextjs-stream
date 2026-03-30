import { userQueries } from '@src/lib/userQueries'
import { hasWatchHistory as checkWatchHistory } from '@src/utils/watchHistory/database'

/**
 * Minimalist function that only checks if a user has any valid watch history.
 * This is much more efficient than the full getFlatRecentlyWatchedForUser when
 * we only need to know if the user has watched anything.
 *
 * @param {string} userId - The ID of the user to check
 * @returns {Promise<boolean>} True if the user has watch history, false otherwise
 */
export async function hasWatchHistory(userId) {
  try {
    // First check if user exists
    const user = await userQueries.findById(userId, { _id: 1 })
    
    if (!user) {
      return false
    }
    
    // Check if user has any valid watch history
    return await checkWatchHistory(userId)
  } catch (error) {
    console.error(`Error in hasWatchHistory: ${error.message}`)
    return false // Default to false on error
  }
}
