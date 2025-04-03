// httpGet.js
import got from 'got';
import { getCache, setCache } from './cache';

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
 * Performs an HTTP GET request with HTTP/2 support, retry, and conditional caching.
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
 * @param {boolean} [returnCacheDataIfAvailable=false] - Return cached data if available
 * @returns {Promise<{ data: Object|string|Buffer|ReadableStream|null, headers: Object }>}
 * @throws {Error} - Throws an error if all retry attempts fail
 */
export async function httpGet(url, options = {}, returnCacheDataIfAvailable = false) {
  const {
    headers = {},
    timeout = 5000,
    responseType = 'json',
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

  // 1) Check the cache for existing ETag and Last-Modified
  const cachedEntry = await getCache(url);
  if (cachedEntry?.etag) {
    headers['If-None-Match'] = cachedEntry.etag;
  }
  if (cachedEntry?.lastModified) {
    headers['If-Modified-Since'] = cachedEntry.lastModified;
  }

  const requestOptions = {
    headers,
    http2: restOptions.http2 !== undefined ? restOptions.http2 : true, // Use passed http2 option or default to true
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
  for (let attempt = 0; attempt <= limit; attempt++) {
    try {
      // Store the response in the outer variable so it can be cleaned up in case of errors
      response = await got(url, requestOptions);
      const { statusCode, headers: responseHeaders } = response;

      if (statusCode === 304) {
        // 2) Handle 304 Not Modified by returning cached data
        if (cachedEntry) {
          // Make sure to clean up the response before returning
          cleanupResponse(response);
          
          //cachedEntry.data is the data that was stored in the
          //cache when the data was last fetched
          if (returnCacheDataIfAvailable) {
            return { data: cachedEntry.data, headers: responseHeaders };
          } else {
            return { data: null, headers: responseHeaders };
          }
        }
      }

      if (statusCode >= 200 && statusCode < 300 || !cachedEntry) {
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

          // 3) Update the cache with new data and validation tokens
          await setCache(
            url,
            responseData,
            responseHeaders.etag || null,
            responseHeaders['last-modified'] || null
          );

          // Clean up the response if we're not returning it directly (stream case)
          if (responseType !== 'stream') {
            cleanupResponse(response);
          }

          return { data: responseData, headers: responseHeaders };
        } catch (processingError) {
          console.error(`Error processing response for ${url}:`, processingError);
          
          // Clean up response resources if there was an error processing the data
          cleanupResponse(response);
          
          throw processingError;
        }
      } else {
        // Clean up response for unsuccessful status codes
        cleanupResponse(response);
        
        throw new Error(`HTTP Error: ${statusCode} for URL: ${url}`);
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
          const data = await fetchResponse.json();
          await setCache(
            url,
            data,
            fetchResponse.headers.get('etag') || null,
            fetchResponse.headers.get('last-modified') || null
          );
          return { data, headers: Object.fromEntries(fetchResponse.headers.entries()) };
        } catch (fetchError) {
          console.error(`Fetch fallback failed for ${url}:`, fetchError);
          // If fetch fails too, continue with retry logic
        }
      }

      if (shouldRetry(error, attempt)) {
        const delay = calculateBackoff(attempt, baseDelay, maxDelay);
        console.warn(
          `Retrying request to ${url} (attempt ${attempt + 1}/${limit}) after ${Math.round(
            delay
          )}ms`
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

  console.error(`Failed to fetch ${url} after ${limit} attempts:`, lastError);
  throw lastError;
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

/**
 * Fetches an image as an ArrayBuffer with retry support.
 * @param {string} url - The URL of the image to fetch.
 * @param {Object} [options={}] - Additional options for the request.
 * @returns {Promise<ArrayBuffer>} - The image data as an ArrayBuffer.
 */
export async function fetchImageAsBuffer(url, options = {}) {
  const response = await httpGet(url, {
    ...options,
    responseType: 'buffer',
    headers: {
      ...options.headers,
      Accept: 'image/*',
    },
  });

  if (response.data === null) {
    // Handle cached data appropriately by retrieving it directly
    const cachedEntry = await getCache(url);
    if (cachedEntry?.data) {
      const buffer = cachedEntry.data.buffer.slice(
        cachedEntry.data.byteOffset,
        cachedEntry.data.byteOffset + cachedEntry.data.byteLength
      );
      return buffer;
    } else {
      throw new Error('No cached data available for image.');
    }
  }

  // Convert Buffer to ArrayBuffer
  return response.data.buffer.slice(
    response.data.byteOffset,
    response.data.byteOffset + response.data.byteLength
  );
}

/**
 * Creates a readable stream for downloading an image with retry support.
 * @param {string} url - The URL of the image to stream.
 * @param {Object} [options={}] - Additional options for the request.
 * @returns {Promise<ReadableStream>} - A readable stream of the image data.
 */
export async function createImageStream(url, options = {}) {
  const response = await httpGet(url, {
    ...options,
    responseType: 'stream',
    headers: {
      ...options.headers,
      Accept: 'image/*',
    },
  });

  if (response.data === null) {
    // Handle cached data by retrieving it directly and converting to stream
    const cachedEntry = await getCache(url);
    if (cachedEntry?.data) {
      const buffer = Buffer.from(cachedEntry.data);
      const stream = Readable.from(buffer);
      return stream;
    } else {
      throw new Error('No cached data available for image.');
    }
  }

  return response.data;
}
