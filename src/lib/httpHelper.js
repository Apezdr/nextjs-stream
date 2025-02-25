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
 * @returns {Promise<{ data: Object|string|Buffer|ReadableStream|null, headers: Object }>}
 * @throws {Error} - Throws an error if all retry attempts fail
 */
export async function httpGet(url, options = {}) {
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
    http2: true,
    timeout: { request: timeout },
    throwHttpErrors: false,
    ...restOptions,
  };

  // Add specific options for streaming if requested
  if (responseType === 'stream') {
    requestOptions.isStream = true;
  }

  let lastError;
  for (let attempt = 0; attempt <= limit; attempt++) {
    try {
      const response = await got(url, requestOptions);
      const { statusCode, headers: responseHeaders } = response;

      if (statusCode === 304) {
        // 2) Handle 304 Not Modified by returning cached data
        if (cachedEntry) {
          //cachedEntry.data is the data that was stored in the
          //cache when the data was last fetched
          return { data: null, headers: responseHeaders };
        }
        // else {
        //   // No cached data exists; handle accordingly
        //   throw new Error(
        //     `Received 304 Not Modified for ${url} but no cached data is available.`
        //   );
        // }
      }

      if (statusCode >= 200 && statusCode < 300 || !cachedEntry) {
        let responseData;

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

        return { data: responseData, headers: responseHeaders };
      } else {
        throw new Error(`HTTP Error: ${statusCode} for URL: ${url}`);
      }
    } catch (error) {
      lastError = error;

      // Sometimes using Http2 with got can cause an error with JSON parsing
      // This is a workaround for that issue
      if (error?.message?.indexOf('Invalid JSON response') > -1) {
        const response = await fetch(url);
        const data = await response.json();
        await setCache(
          url,
          data,
          response.headers.etag || null,
          response.headers['last-modified'] || null
        );
        return { data, headers: response.headers };
      }

      if (shouldRetry(error, attempt)) {
        const delay = calculateBackoff(attempt, baseDelay, maxDelay);
        console.warn(
          `Retrying request to ${url} (attempt ${attempt + 1}/${limit}) after ${Math.round(
            delay
          )}ms`
        );
        await sleep(delay);
        continue;
      }

      break;
    }
  }

  console.error(`Failed to fetch ${url} after ${limit} attempts:`, lastError);
  throw lastError;
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
