// httpGet.js
import got from 'got';

/**
 * Sleep for a specified duration
 * @param {number} ms - Time to sleep in milliseconds
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Calculate delay for exponential backoff
 * @param {number} retry - Current retry attempt
 * @param {number} baseDelay - Base delay in milliseconds
 * @param {number} maxDelay - Maximum delay in milliseconds
 * @returns {number} - Delay in milliseconds
 */
const calculateBackoff = (retry, baseDelay = 1000, maxDelay = 10000) => {
  const delay = Math.min(baseDelay * Math.pow(2, retry), maxDelay);
  // Add jitter to prevent thundering herd
  return delay + Math.random() * 1000;
};

/**
 * The error httpGet throws for a non-2xx response. It carries the status the
 * way got's own HTTPError does (error.response.statusCode), so retry rules can
 * tell a 404, which will not change, from a dropped connection, which might.
 * A bare Error had no status, and every retry rule read that as a network
 * failure, so permanent 4xx answers were retried with full backoff.
 * The body rides along too, so a proxy can pass the upstream's own message and
 * code on to its clients (the TMDB proxy does).
 * @param {number} statusCode - Response status
 * @param {string} url - Requested URL
 * @param {Object} headers - Response headers
 * @param {string} [body] - Response body, capped
 * @returns {Error}
 */
function httpStatusError(statusCode, url, headers, body) {
  const error = new Error(`HTTP Error: ${statusCode} for URL: ${url}`);
  error.statusCode = statusCode;
  error.response = { statusCode, headers, body };
  return error;
}

/**
 * Performs an HTTP GET request with HTTP/2 support and retry.
 * @param {string} url - The URL to fetch.
 * @param {Object} [options={}] - Additional options for the request.
 * @param {Object} [options.headers={}] - HTTP headers to include in the request.
 * @param {number} [options.timeout=5000] - Timeout for the request in milliseconds.
 * @param {string} [options.responseType='json'] - Type of response to return ('json', 'text', 'buffer', or 'stream').
 * @param {Object} [options.retry] - Retry configuration
 * @param {number} [options.retry.limit=3] - Maximum number of retry attempts
 * @param {number} [options.retry.baseDelay=1000] - Base delay for exponential backoff in milliseconds
 * @param {number} [options.retry.maxDelay=10000] - Maximum delay between retries in milliseconds
 * @param {function} [options.retry.shouldRetry] - Custom function to determine if a request should be retried
 * @returns {Promise<{ data: Object|string|Buffer|ReadableStream|null, headers: Object }>} `data` is
 *   null on a 304, which only a caller that sent its own If-None-Match or
 *   If-Modified-Since can get (fetchFile does, from its own cache)
 * @throws {Error} - Throws an error if all retry attempts fail
 */
export async function httpGet(url, options = {}) {
  const {
    headers = {},
    timeout = 5000,
    responseType = options.responseType ?? 'json',
    retry = {},
    ...restOptions
  } = options;

  const {
    limit = 3,
    baseDelay = 1000,
    maxDelay = 10000,
    shouldRetry = (error, attemptCount) => {
      // Default retry conditions
      if (attemptCount >= limit) return false;

      // Retry on network errors
      if (!error.response) return true;

      // Retry on 5xx server errors and specific 4xx errors
      const statusCode = error.response.statusCode;
      return statusCode >= 500 || statusCode === 429 || statusCode === 408;
    },
  } = retry;

  const requestOptions = {
    headers,
    http2: restOptions.http2 !== undefined ? restOptions.http2 : false, // Use passed http2 option or default to false
    timeout: { request: timeout },
    throwHttpErrors: false,
    // Add request ID for better tracking and debug
    //context: { requestId: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` },
    // Enable HTTP/2 with connection cleanup
    // agent: {
    //   http2: true,
    //   keepAlive: true,
    //   keepAliveMsecs: 5000, // 5 seconds
    //   maxSockets: 100,
    //   maxFreeSockets: 10,
    //   // Explicitly clean up sockets after idle time
    //   timeout: 60000, // Close idle sockets after 60 seconds
    // },
    ...restOptions,
  };

  // Add specific options for streaming if requested
  if (responseType === 'stream') {
    requestOptions.isStream = true;
  }

  let lastError;
  let response = null;
  let attemptsMade = 0;
  for (let attempt = 0; attempt <= limit; attempt++) {
    attemptsMade = attempt + 1;
    try {
      // Store the response in the outer variable so it can be cleaned up in case of errors
      response = await got(url, requestOptions);
      const { statusCode, headers: responseHeaders } = response;

      if (statusCode === 304) {
        cleanupResponse(response);
        return { data: null, headers: responseHeaders };
      }

      if (statusCode >= 200 && statusCode < 300) {
        let responseData;

        try {
          switch (responseType) {
            case 'json':
              try {
                responseData = JSON.parse(response.body);
              } catch (parseError) {
                throw new Error(`Invalid JSON response from ${url}`);
              }
              break;

            case 'text':
              responseData = response.body;
              break;

            case 'buffer':
              responseData = Buffer.from(response.rawBody);
              break;

            case 'stream':
              responseData = response;
              // For stream, we don't clean up as the stream is returned to the caller
              break;

            default:
              throw new Error(`Unsupported response type: ${responseType}`);
          }

          // A stream belongs to the caller now: it is not cleaned up here
          if (responseType !== 'stream') cleanupResponse(response);
          return { data: responseData, headers: responseHeaders };
        } catch (processingError) {
          console.error(`Error processing response for ${loggableUrl(url)}: ${describeRequestError(processingError, url)}`);
          debugStack(processingError);
          
          // Clean up response resources if there was an error processing the data
          cleanupResponse(response);
          
          throw processingError;
        }
      } else {
        // Keep the body before cleaning up (capped: an HTML error page can be large)
        const errorBody = typeof response.body === 'string' ? response.body.slice(0, 4096) : undefined;

        // Clean up response for unsuccessful status codes
        cleanupResponse(response);

        throw httpStatusError(statusCode, url, responseHeaders, errorBody);
      }
    } catch (error) {
      // If we have a response object, clean it up to prevent memory leaks
      if (response) {
        cleanupResponse(response);
        response = null;
      }
      
      lastError = error;

      // Sometimes using Http2 with got can cause an error with JSON parsing
      // This is a workaround for that issue
      if (error?.message?.indexOf('Invalid JSON response') > -1) {
        try {
          const fetchResponse = await fetch(url);
          if (!fetchResponse.ok) {
            return fetchResponse;
          }
          const data = await fetchResponse.json();
          return { data, headers: Object.fromEntries(fetchResponse.headers.entries()) };
        } catch (fetchError) {
          console.error(`Fetch fallback failed for ${loggableUrl(url)}: ${describeRequestError(fetchError, url)}`);
          debugStack(fetchError);
          // If fetch fails too, continue with retry logic
        }
      }

      // The loop allows `limit` retries, and never sleeps after the last
      // attempt. Custom rules (backendClient's) ignore attemptCount, so the
      // bound lives here; without it a final, wasted backoff ran after the
      // last request (logged as "attempt 4/3").
      if (attempt < limit && shouldRetry(error, attempt)) {
        const delay = calculateBackoff(attempt, baseDelay, maxDelay);
        console.warn(
          `Retrying request to ${loggableUrl(url)} (attempt ${attempt + 1}/${limit}) after ${Math.round(
            delay
          )}ms: ${describeRequestError(error, url)}`
        );
        await sleep(delay);
        
        // Force garbage collection if available (Node.js with --expose-gc)
        if (global.gc && attempt % 2 === 0) {
          try {
            global.gc();
          } catch (gcError) {
            // Ignore errors from garbage collection
          }
        }
        
        continue;
      }

      break;
    }
  }

  // Make sure we clean up any response that might be lingering
  if (response) {
    cleanupResponse(response);
  }

  // A 404 is an answer the caller handles (a title TMDB doesn't have, an
  // optional file that isn't there), not a failure worth a stack trace
  if (lastError?.statusCode === 404) {
    console.warn(`Not found (404): ${loggableUrl(url)}`);
  } else {
    console.error(
      `Failed to fetch ${loggableUrl(url)} after ${attemptsMade} attempt${attemptsMade === 1 ? '' : 's'}: ` +
        describeRequestError(lastError, url)
    );
    debugStack(lastError);
  }
  throw lastError;
}

/** A query parameter whose value is a credential (an *arr iCal feed's `apikey`), with its value. */
const SECRET_PARAM_IN_TEXT = /([?&](?:api[-_]?key|key|token|access[-_]?token|auth|password|secret|signature|sig)=)[^&#\s"'<>]*/gi

/** The user:password of a URL. */
const USERINFO_IN_TEXT = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]*@/gi

/**
 * Text as a log line or an error message may show it: every credential query
 * parameter's value and every URL's user:password replaced by REDACTED, all
 * else as it is (a file's `?hash=` included). The one redaction for anything
 * that names a URL the sync or the calendar fetches.
 *
 * @param {unknown} text
 * @returns {string}
 */
export function redactSecrets(text) {
  return String(text ?? '').replace(SECRET_PARAM_IN_TEXT, '$1REDACTED').replace(USERINFO_IN_TEXT, '$1REDACTED@')
}

/**
 * A URL as a log line may show it (redactSecrets): the query kept, a
 * credential parameter's value and any user:password replaced.
 *
 * @param {string} url
 * @returns {string}
 */
export function loggableUrl(url) {
  return redactSecrets(url)
}

/**
 * One line about a failed request: its error's name, code, HTTP status and
 * message (on one line, cut to 160 characters). Never the error object itself:
 * got's RequestError prints its options, timings and agents, about 2,000
 * lines a failure.
 *
 * The message may name the request's URL (httpGet's own errors do, and keep
 * it as it is for their callers): it is shown as loggableUrl shows it, and
 * any other credential in the message is redacted too.
 *
 * @param {unknown} error
 * @param {string} [url] - The request's URL, replaced inside the message
 * @returns {string}
 */
export function describeRequestError(error, url) {
  const name = error?.name || 'Error'
  const code = error?.code ? ` ${error.code}` : ''
  const status = error?.response?.statusCode ?? error?.statusCode
  let raw = String(error?.message ?? error ?? '')
  if (typeof url === 'string' && url) raw = raw.split(url).join(loggableUrl(url))
  const message = redactSecrets(raw).replace(/\s+/g, ' ').trim()
  const shown = message.length > 160 ? `${message.slice(0, 159)}…` : message
  return `${name}${code}${status ? ` HTTP ${status}` : ''}: ${shown}`
}

/** The stack of a failed request, only when DEBUG is set. */
function debugStack(error) {
  if (process.env.DEBUG && error?.stack) console.debug(error.stack)
}

/**
 * Cleans up a response object to prevent memory leaks
 * @param {Object} response - The response object to clean up
 */
function cleanupResponse(response) {
  try {
    if (!response) return;
    
    // Close any open streams
    if (typeof response.destroy === 'function') {
      response.destroy();
    }
    
    // If it's a stream, end it
    if (typeof response.end === 'function') {
      response.end();
    }
    
    // If it has a body that should be released
    if (response.body && typeof response.body.destroy === 'function') {
      response.body.destroy();
    }
    
    // If it has a connection property that can be destroyed
    if (response.connection && typeof response.connection.destroy === 'function') {
      response.connection.destroy();
    }
    
    // If it has a socket that can be destroyed
    if (response.socket && typeof response.socket.destroy === 'function') {
      response.socket.destroy();
    }
    
    // Clear any event listeners
    if (typeof response.removeAllListeners === 'function') {
      response.removeAllListeners();
    }
  } catch (error) {
    console.error('Error cleaning up response:', error);
  }
}
