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
 * Performs an HTTP GET request with HTTP/2 support and retry capability.
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
    }
  } = retry;

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

      if (statusCode >= 200 && statusCode < 300) {
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

        return { data: responseData, headers: responseHeaders };
      } else if (statusCode === 304) {
        return { data: null, headers: responseHeaders };
      } else {
        throw new Error(`HTTP Error: ${statusCode} for URL: ${url}`);
      }

    } catch (error) {
      lastError = error;
      
      if (shouldRetry(error, attempt)) {
        const delay = calculateBackoff(attempt, baseDelay, maxDelay);
        console.warn(`Retrying request to ${url} (attempt ${attempt + 1}/${limit}) after ${delay}ms`);
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

  return response.data;
}