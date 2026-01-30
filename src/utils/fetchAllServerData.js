import {
  getAllServers,
  getSyncUrls,
  fileServerVersionTV,
  fileServerVersionMOVIES
} from "./config";
import { getWebhookIdForServer } from './webhookServer.js';

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
 * @param {Object} options - Fetch options (headers, method, etc.).
 * @param {number} timeoutMs - Timeout in milliseconds (default: 10000).
 * @returns {Promise<Response>} Fetch response.
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  return Promise.race([
    fetch(url, options),
    timeout(timeoutMs)
  ]);
}

/**
 * Sleep for a specified duration.
 * @param {number} ms - Time to sleep in milliseconds.
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate delay for exponential backoff with jitter.
 * @param {number} attempt - Current attempt number (0-based).
 * @param {number} baseDelay - Base delay in milliseconds.
 * @param {number} maxDelay - Maximum delay in milliseconds.
 * @returns {number} - Delay in milliseconds.
 */
function calculateBackoff(attempt, baseDelay = 1000, maxDelay = 30000) {
  const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  // Add jitter to prevent thundering herd (±25% variation)
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return Math.max(delay + jitter, 100); // Minimum 100ms delay
}

/**
 * Determines if an error should trigger a retry.
 * @param {Error} error - The error to evaluate.
 * @param {number} attempt - Current attempt number.
 * @param {number} maxRetries - Maximum number of retries.
 * @returns {boolean} - Whether to retry the request.
 */
function shouldRetryRequest(error, attempt, maxRetries) {
  if (attempt >= maxRetries) return false;
  
  // Always retry on timeout errors
  if (error.message.includes('timed out')) return true;
  
  // Always retry on network errors (no response)
  if (!error.response && error.message.includes('fetch')) return true;
  
  // Retry on server errors (5xx) and specific client errors
  if (error.status) {
    return error.status >= 500 || error.status === 429 || error.status === 408;
  }
  
  // Default to retry for unknown errors (could be transient)
  return true;
}

/**
 * Fetches data from a specific server with retry logic and timeout.
 * @param {Object} server - Server configuration.
 * @param {number} timeoutMs - Timeout in milliseconds (default: 10000).
 * @param {number} maxRetries - Maximum number of retry attempts (default: 3).
 * @returns {Promise<Object>} Server data.
 */
async function fetchServerData(server, timeoutMs = 10000, maxRetries = 3) {
  const syncUrls = getSyncUrls(server.id);
  let lastError = null;
  
  // Get the webhook ID for this server
  const webhookId = await getWebhookIdForServer(server.id);
  
  console.log(`[AUTH DEBUG] Server: ${server.id}, Webhook ID: ${webhookId ? `${webhookId.substring(0, 8)}...` : 'NOT FOUND'}`);
  console.log(`[AUTH DEBUG] Environment WEBHOOK_ID exists: ${!!process.env.WEBHOOK_ID}`);
  
  if (!webhookId) {
    console.error(`No webhook ID configured for server ${server.id}. Check WEBHOOK_ID environment variable.`);
    return {
      id: server.id,
      baseURL: server.baseURL,
      prefixPath: server.prefixPath,
      syncEndpoint: server.syncEndpoint,
      priority: server.priority,
      error: 'Missing webhook authentication configuration',
      data: null
    };
  }
  
  // Create headers with webhook authentication
  const headers = {
    'x-webhook-id': webhookId,
    'Content-Type': 'application/json'
  };
  
  console.log(`[AUTH DEBUG] Request URLs - TV: ${syncUrls.tv}, Movies: ${syncUrls.movies}`);
  console.log(`[AUTH DEBUG] Headers being sent:`, { 'x-webhook-id': webhookId.substring(0, 8) + '...', 'Content-Type': 'application/json' });
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = calculateBackoff(attempt - 1);
        console.log(`Retrying server ${server.id} fetch (attempt ${attempt + 1}/${maxRetries + 1}) after ${Math.round(delay)}ms...`);
        await sleep(delay);
      }
      
      console.log(`[AUTH DEBUG] Attempt ${attempt + 1}: Making authenticated request to sync endpoints`);
      
      const [tvResponse, moviesResponse] = await Promise.all([
        fetchWithTimeout(syncUrls.tv, { headers }, timeoutMs),
        fetchWithTimeout(syncUrls.movies, { headers }, timeoutMs)
      ]);
      
      console.log(`[AUTH DEBUG] Response statuses - TV: ${tvResponse.status}, Movies: ${moviesResponse.status}`);

      if (!tvResponse.ok) {
        const error = new Error(`Failed to fetch TV data from ${syncUrls.tv}: ${tvResponse.status} ${tvResponse.statusText}`);
        error.status = tvResponse.status;
        throw error;
      }
      if (!moviesResponse.ok) {
        const error = new Error(`Failed to fetch movies data from ${syncUrls.movies}: ${moviesResponse.status} ${moviesResponse.statusText}`);
        error.status = moviesResponse.status;
        throw error;
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

      if (attempt > 0) {
        console.log(`Successfully fetched data from server ${server.id} after ${attempt + 1} attempts`);
      }

      return {
        id: server.id,
        baseURL: server.baseURL,
        prefixPath: server.prefixPath,
        syncEndpoint: server.syncEndpoint,  // Node.js server URL for API endpoints
        priority: server.priority,
        data: {
          tv: tvData,
          movies: moviesData
        }
      };
    } catch (error) {
      lastError = error;
      
      if (shouldRetryRequest(error, attempt, maxRetries)) {
        console.warn(`Server ${server.id} fetch failed (attempt ${attempt + 1}/${maxRetries + 1}): ${error.message}`);
        continue;
      } else {
        console.error(`Server ${server.id} fetch failed after ${attempt + 1} attempts, giving up: ${error.message}`);
        break;
      }
    }
  }
  
  // All retries exhausted
  console.error(`Error fetching data from server ${server.baseURL} / ${server.id} after ${maxRetries + 1} attempts:`, lastError);
  return {
    id: server.id,
    baseURL: server.baseURL,
    prefixPath: server.prefixPath,
    syncEndpoint: server.syncEndpoint,  // Node.js server URL for API endpoints
    priority: server.priority,
    error: lastError.message,
    data: null
  };
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
          syncEndpoint: result.syncEndpoint,  // Node.js server URL for API endpoints
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
}
