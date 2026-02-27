import clientPromise from '@src/lib/mongodb'
import { ObjectId } from 'mongodb'

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
    const client = await clientPromise
    
    // First check if user exists
    const user = await client
      .db('Users')
      .collection('AuthenticatedUsers')
      .findOne({ _id: new ObjectId(userId) }, { projection: { _id: 1 } })
    
    if (!user) {
      return false
    }
    
    // Check if user has any valid watch history in WatchHistory collection
    const watchHistoryEntry = await client
      .db('Media')
      .collection('WatchHistory')
      .findOne(
        { 
          userId: user._id,
          isValid: true
        },
        { projection: { _id: 1 } }
      )
    
    // If we found a document, the user has watch history
    return !!watchHistoryEntry
  } catch (error) {
    console.error(`Error in hasWatchHistory: ${error.message}`)
    return false // Default to false on error
  }
}
