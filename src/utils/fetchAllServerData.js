import { 
  getAllServers, 
  getSyncUrls, 
  fileServerVersionTV, 
  fileServerVersionMOVIES 
} from "./config";

/**
 * Creates a timeout promise that rejects after specified milliseconds.
 * @param {number} timeoutMs - Timeout in milliseconds.
 * @returns {Promise} A promise that rejects after the timeout.
 */
function timeout(timeoutMs) {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

/**
 * Wraps a fetch request with a timeout.
 * @param {string} url - URL to fetch.
 * @param {number} timeoutMs - Timeout in milliseconds (default: 10000).
 * @returns {Promise<Response>} Fetch response.
 */
async function fetchWithTimeout(url, timeoutMs = 10000) {
  return Promise.race([
    fetch(url),
    timeout(timeoutMs)
  ]);
}

/**
 * Fetches data from a specific server with timeout.
 * @param {Object} server - Server configuration.
 * @param {number} timeoutMs - Timeout in milliseconds (default: 10000).
 * @returns {Promise<Object>} Server data.
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
      console.error(
        `TV data version mismatch: ${tvData.version ?? "no version"} not equal to expected ${fileServerVersionTV} (${syncUrls.tv})`
      );
    }
    if (moviesData.version !== fileServerVersionMOVIES) {
      console.error(
        `Movies data version mismatch: ${moviesData.version ?? "no version"} not equal to expected ${fileServerVersionMOVIES} (${syncUrls.movies})`
      );
    }
    
    // Remove version keys before returning the data.
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

/**
 * Fetches data from all configured servers and organizes the results.
 *
 * @async
 * @function fetchAllServerData
 * @returns {Promise<Object>} A promise that resolves to an object containing:
 *   - `fileServers` {Object}: A mapping of server IDs to their respective data and configuration.
 *   - `errors` {Array<Object>}: An array of errors from failed servers, where each error object contains:
 *       - `serverId` {string}: The ID of the server that failed.
 *       - `error` {string}: The error encountered while fetching data from the server.
 * @throws {Error} If an unexpected error occurs during the data fetching process.
 */
export async function fetchAllServerData() {
  try {
    const servers = getAllServers();
    const serverResults = await Promise.all(
      servers.map((server) => fetchServerData(server))
    );

    // Build fileServers object for servers with data
    const fileServers = serverResults.reduce((acc, result) => {
      if (result.data) {
        acc[result.id] = {
          config: {
            baseURL: result.baseURL,
            prefixPath: result.prefixPath,
            priority: result.priority
          },
          ...result.data
        };
      }
      return acc;
    }, {});

    // Collect any errors from servers that failed to provide data
    const errors = serverResults
      .filter(result => result.error)
      .map(result => ({
        serverId: result.id,
        error: result.error
      }));

    return { fileServers, errors };
  } catch (error) {
    throw error;
  }
}
