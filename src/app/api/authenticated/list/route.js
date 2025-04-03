import { fileServerVersionMOVIES, fileServerVersionTV, getAllServers, getSyncUrls } from '@src/utils/config'
import { isAdminOrWebhook } from '../../../../utils/routeAuth'
import { getAllMedia } from '@src/utils/admin_database'

/**
 * Creates a timeout promise that rejects after specified milliseconds
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise} Promise that rejects after timeout
 */
function timeout(timeoutMs) {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

/**
 * Wraps a fetch request with a timeout
 * @param {string} url - URL to fetch
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<Response>} Fetch response
 */
async function fetchWithTimeout(url, timeoutMs = 10000) {
  return Promise.race([
    fetch(url),
    timeout(timeoutMs)
  ]);
}

/**
 * Fetches data from a specific server with timeout
 * @param {Object} server - Server configuration
 * @param {number} timeoutMs - Timeout in milliseconds (default: 10000)
 * @returns {Promise<Object>} Server data
 */
async function fetchServerData(server, timeoutMs = 10000) {
  const syncUrls = getSyncUrls(server.id);
  
  try {
    const [tvResponse, moviesResponse] = await Promise.all([
      fetchWithTimeout(syncUrls.tv, timeoutMs),
      fetchWithTimeout(syncUrls.movies, timeoutMs)
    ]);

    if (!tvResponse.ok) {
      throw new Error(`Failed to fetch TV data from ${syncUrls.tv}`);
    }
    if (!moviesResponse.ok) {
      throw new Error(`Failed to fetch movies data from ${syncUrls.movies}`);
    }

    const [tvData, moviesData] = await Promise.all([
      tvResponse.json(),
      moviesResponse.json()
    ]);

    if (tvData.version !== fileServerVersionTV) {
      console.error(`TV data version mismatch: ${tvData.version ?? `file server doesn't have a version or`} not equal to existing version ${fileServerVersionTV}: ${syncUrls.tv}`);
      //throw new Error(`TV data version mismatch: ${tvData.version ?? `file server doesn't have a version or`} not equal to existing version ${fileServerVersionTV}`);
    }
    if (moviesData.version !== fileServerVersionMOVIES) {
      console.error(`Movies data version mismatch: ${moviesData.version ?? `file server doesn't have a version or`} not equal to existing version ${fileServerVersionMOVIES}: ${syncUrls.movies}`);
      //throw new Error(`Movies data version mismatch: ${moviesData.version ?? `file server doesn't have a version or`} not equal to existing version ${fileServerVersionMOVIES}`);
    }
    delete tvData.version;
    delete moviesData.version;

    return {
      id: server.id,
      baseURL: server.baseURL,
      prefixPath: server.prefixPath,
      priority: server.priority,
      data: {
        tv: tvData,
        movies: moviesData
      }
    };
  } catch (error) {
    console.error(`Error fetching data from server ${server.baseURL} / ${server.id}:`, error);
    return {
      id: server.id,
      baseURL: server.baseURL,
      prefixPath: server.prefixPath,
      priority: server.priority,
      error: error.message,
      data: null
    };
  }
}

export const GET = async (req) => {
  const authResult = await isAdminOrWebhook(req)
  if (authResult instanceof Response) {
    return authResult
  }

  try {
    // Fetch data from all configured servers
    const servers = getAllServers()
    const serverDataPromises = servers.map((server) => fetchServerData(server))
    const serverResults = await Promise.all(serverDataPromises)

    // Filter out failed servers and format response
    const fileServers = serverResults.reduce((acc, result) => {
      if (result.data) {
        acc[result.id] = {
          config: {
            baseURL: result.baseURL,
            prefixPath: result.prefixPath,
            priority: result.priority
          },
          ...result.data
        }
      }
      return acc
    }, {})

    // Collect errors from failed servers
    const errors = serverResults
      .filter(result => result.error)
      .map(result => ({
        serverId: result.id,
        error: result.error
      }))

    return new Response(
      JSON.stringify({
        fileServers,
        errors: errors.length > 0 ? errors : undefined
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  } catch (error) {
    console.error('Failed to sync data:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Failed to sync data',
        details: error.message
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
}