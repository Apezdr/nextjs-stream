import { getFlatRequestedMedia } from '@src/utils/flatDatabaseUtils';
import { getRequestedMedia } from '@src/utils/database';

/**
 * Check if the environment is configured to use the flat database.
 * @returns {boolean} True if flat database should be used, false otherwise.
 */
function shouldUseFlatDatabase() {
  // This could be a config setting or environment variable
  return true; // For now, always use flat database
}

/**
 * Adapter function that selects the appropriate database implementation
 * based on configuration.
 * 
 * @param {Object} params - The media request parameters
 * @param {string} params.type - The type of media (movie or tv)
 * @param {string} [params.title] - The title of the media
 * @param {string} [params.id] - The ID of the media
 * @param {string} [params.season] - The season number for TV shows
 * @param {string} [params.episode] - The episode number for TV shows with season
 * @returns {Promise<Object|null>} The requested media or null if not found
 */
export async function getAdaptedRequestedMedia(params) {
  try {
    if (shouldUseFlatDatabase()) {
      return await getFlatRequestedMedia(params);
    } else {
      return await getRequestedMedia(params);
    }
  } catch (error) {
    console.error('Error in getAdaptedRequestedMedia:', error);
    
    // If flat database fails, try original function as fallback
    if (shouldUseFlatDatabase()) {
      console.log('Falling back to original database structure');
      try {
        return await getRequestedMedia(params);
      } catch (fallbackError) {
        console.error('Fallback also failed:', fallbackError);
        return null;
      }
    }
    
    return null;
  }
}
