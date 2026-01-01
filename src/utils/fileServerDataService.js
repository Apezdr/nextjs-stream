import { fetchAllServerData } from './fetchAllServerData';

/**
 * Shared service for fetching file server data
 * Can be used by both API endpoints and internal calls
 * 
 * @param {Object} options - Options for fetching server data
 * @param {boolean} options.skipAuth - Skip authentication check (for internal calls)
 * @returns {Promise<{fileServers: Object, errors: Array}>}
 */
export async function getFileServerData(options = {}) {
  const { skipAuth = false } = options;
  
  try {
    const { fileServers, errors } = await fetchAllServerData();

    return {
      fileServers,
      errors: errors.length > 0 ? errors : undefined
    };
  } catch (error) {
    console.error('Failed to fetch file server data:', error);
    throw new Error(`Failed to fetch file server data: ${error.message}`);
  }
}
