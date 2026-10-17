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

/** The two payloads a server publishes, in the order they are fetched and parsed. */
const PAYLOAD_KINDS = ['tv', 'movies'];

const PAYLOAD_LABELS = { tv: 'TV', movies: 'movies' };
const VERSION_LABELS = { tv: 'TV', movies: 'Movies' };
const EXPECTED_VERSIONS = { tv: fileServerVersionTV, movies: fileServerVersionMOVIES };

/**
 * Headers for one payload request. With a validator (the ETag of the payload
 * last applied, exactly as the server sent it) the request is conditional:
 * If-None-Match plus `Cache-Control: max-age=0`. The second header is not
 * optional: Node's fetch adds `Cache-Control: no-cache` to any request that
 * carries If-None-Match, and Express never answers 304 to no-cache.
 *
 * @param {Object} baseHeaders
 * @param {string|null|undefined} validator
 * @returns {Object}
 */
function payloadRequestHeaders(baseHeaders, validator) {
  if (!validator) return baseHeaders;
  return { ...baseHeaders, 'If-None-Match': validator, 'Cache-Control': 'max-age=0' };
}

/**
 * Fetches data from a specific server with retry logic and timeout.
 * @param {Object} server - Server configuration.
 * @param {number} timeoutMs - Timeout in milliseconds (default: 10000).
 * @param {number} maxRetries - Maximum number of retry attempts (default: 3).
 * @param {Object} [request]
 * @param {{tv?: string, movies?: string}|null} [request.validators] - ETags to
 *   send as If-None-Match; a payload without one is fetched unconditionally.
 * @param {string[]} [request.kinds] - Which payloads to fetch (default both).
 * @returns {Promise<Object>} Server data. `payloads[kind]` holds the status
 *   (200, or 304 for an unchanged payload, which has no data), the ETag and
 *   the parsed data; `data` holds `{ tv, movies }` when both were fetched.
 */
async function fetchServerData(server, timeoutMs = 10000, maxRetries = 3, request = {}) {
  const { validators = null, kinds = PAYLOAD_KINDS } = request;
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

      const responses = await Promise.all(
        kinds.map((kind) =>
          fetchWithTimeout(
            syncUrls[kind],
            { headers: payloadRequestHeaders(headers, validators?.[kind]) },
            timeoutMs
          )
        )
      );

      console.log(
        `[AUTH DEBUG] Response statuses - ` +
        kinds.map((kind, i) => `${PAYLOAD_LABELS[kind]}: ${responses[i].status}`).join(', ')
      );

      // 304 is an answer only to a conditional request: the payload is the one
      // last applied, and the response has no body.
      const notModified = kinds.map((kind, i) => responses[i].status === 304 && Boolean(validators?.[kind]));
      kinds.forEach((kind, i) => {
        if (notModified[i] || responses[i].ok) return;
        const error = new Error(`Failed to fetch ${PAYLOAD_LABELS[kind]} data from ${syncUrls[kind]}: ${responses[i].status} ${responses[i].statusText}`);
        error.status = responses[i].status;
        throw error;
      });

      // Download the bodies as text (async, streamed) and parse them
      // separately: response.json() buffers AND parses in one synchronous
      // block, which for full-library payloads holds the event loop for the
      // combined duration. Parsing the two payloads with a yield in between
      // halves the longest block, and the timing log quantifies whether a
      // worker-thread offload is warranted (sync-tick stall follow-up).
      const texts = await Promise.all(
        responses.map((response, i) => (notModified[i] ? null : response.text()))
      );

      const parseStart = performance.now();
      const parsed = [];
      for (let i = 0; i < kinds.length; i++) {
        if (texts[i] === null) {
          parsed.push(null);
          continue;
        }
        if (parsed.some((data) => data !== null)) {
          await new Promise((resolve) => setImmediate(resolve));
        }
        const data = JSON.parse(texts[i]);
        // A payload is an object keyed by title. Anything else (null, an array,
        // a bare value) is a broken response: fail the request, so the server
        // is retried and then reported as not answering — never synced as a
        // server with no titles.
        if (data === null || typeof data !== 'object' || Array.isArray(data)) {
          throw new Error(`${PAYLOAD_LABELS[kinds[i]]} payload from ${syncUrls[kinds[i]]} is not an object`);
        }
        parsed.push(data);
      }
      if (texts.some((text) => text !== null)) {
        console.log(
          `[SYNC PERF] ${server.id}: parsed ` +
          kinds
            .map((kind, i) => (texts[i] === null ? `${kind}=304` : `${kind}=${(texts[i].length / 1048576).toFixed(1)}MB`))
            .join(' + ') +
          ` in ${(performance.now() - parseStart).toFixed(0)}ms`
        );
      }

      const payloads = {};
      kinds.forEach((kind, i) => {
        const data = parsed[i];
        if (data !== null) {
          if (data.version !== EXPECTED_VERSIONS[kind]) {
            console.error(
              `${VERSION_LABELS[kind]} data version mismatch: ${data.version ?? "no version"} not equal to expected ${EXPECTED_VERSIONS[kind]} (${syncUrls[kind]})`
            );
          }
          // Remove version keys before returning the data.
          delete data.version;
        }
        payloads[kind] = {
          status: notModified[i] ? 304 : responses[i].status,
          // Kept verbatim (weak or strong) and sent back as it came. A 304
          // confirms the validator that was sent, so that one is kept.
          etag: notModified[i] ? validators[kind] : (responses[i].headers.get('etag') || null),
          data,
        };
      });

      if (attempt > 0) {
        console.log(`Successfully fetched data from server ${server.id} after ${attempt + 1} attempts`);
      }

      return {
        id: server.id,
        baseURL: server.baseURL,
        prefixPath: server.prefixPath,
        syncEndpoint: server.syncEndpoint,  // Node.js server URL for API endpoints
        priority: server.priority,
        payloads,
        data: payloads.tv?.data != null && payloads.movies?.data != null
          ? { tv: payloads.tv.data, movies: payloads.movies.data }
          : null
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
 * With `options.validators` the payload requests are conditional (see
 * payloadRequestHeaders). When every server answers 304 for both payloads,
 * nothing is downloaded or parsed and the result says `notModified: true`.
 * Otherwise the payloads that answered 304 are fetched again without
 * If-None-Match: a pass decides ownership across every server's payload, so it
 * needs all of them, not just the ones that changed.
 *
 * @async
 * @function fetchAllServerData
 * @param {Object} [options]
 * @param {Object<string, {tv?: string, movies?: string}>} [options.validators] -
 *   Per server id, the ETags of the payloads last applied. Omit for an
 *   unconditional fetch (every caller other than the sync tick).
 * @returns {Promise<Object>} A promise that resolves to an object containing:
 *   - `fileServers` {Object}: A mapping of server IDs to their respective data and configuration.
 *   - `errors` {Array<Object>}: An array of errors from failed servers, where each error object contains:
 *       - `serverId` {string}: The ID of the server that failed.
 *       - `error` {string}: The error encountered while fetching data from the server.
 *   - `notModified` {boolean}: true when every server answered 304 for both
 *       payloads (then `fileServers` is empty).
 *   - `statuses` {Object}: per server id, `{ tv, movies }` — the status each
 *       payload first answered with (304 = unchanged); servers that failed are absent.
 *   - `etags` {Object}: per server id, `{ tv, movies }` — the ETag of the
 *       payload in `fileServers` (or of the unchanged one), null when the
 *       server sent none; servers that failed are absent.
 * @throws {Error} If an unexpected error occurs during the data fetching process.
 */
export async function fetchAllServerData(options = {}) {
  const validators = options.validators || null;
  const servers = getAllServers();
  let serverResults = await Promise.all(
    servers.map((server) =>
      fetchServerData(server, undefined, undefined, { validators: validators?.[server.id] || null })
    )
  );

  const statuses = {};
  for (const result of serverResults) {
    if (result.payloads) {
      statuses[result.id] = Object.fromEntries(PAYLOAD_KINDS.map((kind) => [kind, result.payloads[kind].status]));
    }
  }

  const allNotModified = Boolean(validators) && serverResults.length > 0 &&
    serverResults.every((result) => !result.error && PAYLOAD_KINDS.every((kind) => result.payloads?.[kind]?.status === 304));
  if (allNotModified) {
    return { fileServers: {}, errors: [], notModified: true, statuses, etags: collectETags(serverResults) };
  }

  if (validators) {
    serverResults = await Promise.all(
      serverResults.map(async (result, i) => {
        if (result.error) return result;
        const unchanged = PAYLOAD_KINDS.filter((kind) => result.payloads[kind].status === 304);
        if (unchanged.length === 0) return result;
        const refetched = await fetchServerData(servers[i], undefined, undefined, { kinds: unchanged });
        if (refetched.error) return refetched;
        const payloads = { ...result.payloads, ...refetched.payloads };
        return { ...result, payloads, data: { tv: payloads.tv.data, movies: payloads.movies.data } };
      })
    );
  }

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

  return { fileServers, errors, notModified: false, statuses, etags: collectETags(serverResults) };
}

/**
 * Per server id, the ETag of each payload fetched (or confirmed unchanged).
 * @param {Array<Object>} serverResults
 * @returns {Object<string, {tv: string|null, movies: string|null}>}
 */
function collectETags(serverResults) {
  const etags = {};
  for (const result of serverResults) {
    if (result.error || !result.payloads) continue;
    etags[result.id] = Object.fromEntries(PAYLOAD_KINDS.map((kind) => [kind, result.payloads[kind]?.etag ?? null]));
  }
  return etags;
}
