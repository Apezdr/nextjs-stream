// httpGet.js
import got from 'got';
import { getCache, setCache } from './cache';
import crypto from 'crypto';
import { Readable } from 'stream';

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
 * Ensures a value is a proper Buffer object, handling various serialized forms
 * @param {any} data - The data to convert to Buffer
 * @param {boolean} [logErrors=false] - Whether to log conversion errors
 * @returns {Buffer|null} - The converted Buffer or null if conversion failed
 */
function ensureBuffer(data, logErrors = false) {
  // If it's already a Buffer, return it directly
  if (Buffer.isBuffer(data)) return data;
  
  try {
    // Case 1: Handle serialized Buffer from JSON with type and data properties
    if (data && data.type === 'Buffer' && Array.isArray(data.data)) {
      return Buffer.from(data.data);
    }
    
    // Case 2: Handle ArrayBuffer-like objects
    if (data && typeof data === 'object' && data.buffer instanceof ArrayBuffer) {
      return Buffer.from(
        data.buffer, 
        data.byteOffset || 0, 
        data.byteLength
      );
    }
    
    // Case 3: Handle serialized Buffer object with _dataType and data properties (our custom format)
    if (data && typeof data === 'object' && data._dataType === 'buffer') {
      if (Buffer.isBuffer(data.data)) {
        return data.data;
      } else if (data.data && data.data.type === 'Buffer' && Array.isArray(data.data.data)) {
        return Buffer.from(data.data.data);
      }
    }
    
    // Case 4: Handle plain objects that might be serialized Buffers
    if (data && typeof data === 'object') {
      // Try to detect if this is a serialized Buffer by checking string form
      const serialized = JSON.stringify(data);
      if (serialized.includes('"type":"Buffer"') && serialized.includes('"data":[')) {
        try {
          const parsed = typeof data === 'string' ? JSON.parse(data) : data;
          return Buffer.from(parsed.data || []);
        } catch (e) {
          if (logErrors) console.error('Failed to parse serialized Buffer:', e);
        }
      }
    }
    
    // Case 5: If data is an array of numbers, treat as Buffer data
    if (Array.isArray(data) && data.every(item => typeof item === 'number')) {
      return Buffer.from(data);
    }
  } catch (error) {
    if (logErrors) console.error('Error converting to Buffer:', error);
  }
  
  // If we can't convert it, return null
  return null;
}

/**
 * Formats byte size to human readable string
 * @param {number} bytes - Size in bytes
 * @returns {string} - Formatted size
 */
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

/**
 * Cache logger for diagnostics
 */
const cacheLog = {
  hit: (url, type, size) => console.debug(`Cache HIT: ${url} (${type}, ${formatBytes(size || 0)})`),
  miss: (url, reason) => console.debug(`Cache MISS: ${url} (${reason})`),
  store: (url, type, size) => console.debug(`Cache STORE: ${url} (${type}, ${formatBytes(size || 0)})`),
  error: (url, error) => console.error(`Cache ERROR: ${url}`, error)
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
 * @returns {Promise<{ data: Object|string|Buffer|ReadableStream|null, headers: Object, meta?: Object }>}
 * @throws {Error} - Throws an error if all retry attempts fail
 */
export async function httpGet(url, options = {}, returnCacheDataIfAvailable = false) {
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
          
          // Handle cached data properly based on response type
          if (returnCacheDataIfAvailable) {
            // If this is a buffer response, ensure we return a proper Buffer
            if (responseType === 'buffer') {
              const cachedBuffer = ensureBuffer(cachedEntry.data, true);
              
              if (cachedBuffer) {
                cacheLog.hit(url, 'buffer', cachedBuffer.length);
                return { 
                  data: cachedBuffer, 
                  headers: responseHeaders,
                  meta: { source: 'cache', originalType: 'buffer' }
                };
              } else {
                // If we couldn't convert to Buffer, log it and treat as cache miss
                cacheLog.miss(url, 'invalid buffer format in cache');
                // Continue with the next attempt to get fresh data
                continue;
              }
            }
            
            // For other types, return the cached data directly
            cacheLog.hit(url, responseType, 
              typeof cachedEntry.data === 'string' ? cachedEntry.data.length : undefined);
            
            return { 
              data: cachedEntry.data, 
              headers: responseHeaders,
              meta: { source: 'cache', originalType: responseType }
            };
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
              
              // Create a hash for integrity verification
              const hash = crypto.createHash('md5').update(responseData).digest('hex');
              
              // Store with the buffer data and type metadata
              await setCache(
                url,
                {
                  _dataType: 'buffer',
                  _hash: hash,
                  _byteLength: responseData.byteLength,
                  data: responseData
                },
                responseHeaders.etag || null,
                responseHeaders['last-modified'] || null
              );
              
              cacheLog.store(url, 'buffer', responseData.byteLength);
              
              // Clean up the response
              cleanupResponse(response);
              
              return { 
                data: responseData, 
                headers: responseHeaders,
                meta: { source: 'fresh', originalType: 'buffer' }
              };
              break;

            case 'stream':
              responseData = response;
              // For stream, we don't clean up as the stream is returned to the caller
              break;

            default:
              throw new Error(`Unsupported response type: ${responseType}`);
          }

          // 3) Update the cache with new data and validation tokens
          // For non-buffer, non-stream responses
          if (responseType !== 'buffer' && responseType !== 'stream') {
            // Store with metadata about the type
            await setCache(
              url,
              {
                _dataType: responseType,
                _isBuffer: false,
                data: responseData
              },
              responseHeaders.etag || null,
              responseHeaders['last-modified'] || null
            );
            
            cacheLog.store(url, responseType, 
              typeof responseData === 'string' ? responseData.length : undefined);
            
            // Clean up the response
            cleanupResponse(response);
            
            return { 
              data: responseData, 
              headers: responseHeaders,
              meta: { source: 'fresh', originalType: responseType }
            };
          }
          
          // For stream responses, we don't cache and return directly
          if (responseType === 'stream') {
            return { 
              data: responseData, 
              headers: responseHeaders,
              meta: { source: 'fresh', originalType: 'stream' }
            };
          }
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
          if (!fetchResponse.ok) {
            return fetchResponse;
          }
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
  }, true); // Always return cached data if available for images

  if (response.data === null) {
    // Handle cached data appropriately by retrieving it directly
    const cachedEntry = await getCache(url);
    if (cachedEntry?.data) {
      // Try multiple methods to extract buffer from cached data
      const buffer = ensureBuffer(cachedEntry.data, true);
      
      if (buffer) {
        return buffer;
      } else if (cachedEntry.data.buffer) {
        return Buffer.from(
          cachedEntry.data.buffer, 
          cachedEntry.data.byteOffset || 0, 
          cachedEntry.data.byteLength
        );
      } else {
        throw new Error('Could not convert cached data to Buffer.');
      }
    } else {
      throw new Error('No cached data available for image.');
    }
  }

  // If response.data is already a Buffer, return it directly
  if (Buffer.isBuffer(response.data)) {
    return response.data;
  }
  
  // Otherwise, try to convert to Buffer
  const buffer = ensureBuffer(response.data, true);
  if (buffer) {
    return buffer;
  }
  
  // Last resort - try to convert using buffer slice if available
  if (response.data.buffer) {
    return Buffer.from(
      response.data.buffer,
      response.data.byteOffset || 0,
      response.data.byteLength
    );
  }
  
  throw new Error('Could not convert response data to Buffer');
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
  }, true); // Always return cached data if available for images

  if (response.data === null) {
    // Handle cached data by retrieving it directly and converting to stream
    const cachedEntry = await getCache(url);
    if (cachedEntry?.data) {
      // Try to convert the cached data to a buffer first
      const buffer = ensureBuffer(cachedEntry.data, true);
      
      if (buffer) {
        // Create a stream from the buffer
        return Readable.from(buffer);
      } else if (typeof cachedEntry.data === 'string') {
        // If it's a string, convert to buffer first
        return Readable.from(Buffer.from(cachedEntry.data));
      } else if (cachedEntry.data._dataType === 'buffer' && cachedEntry.data.data) {
        // Handle our wrapped buffer format
        const nestedBuffer = ensureBuffer(cachedEntry.data.data, true);
        if (nestedBuffer) {
          return Readable.from(nestedBuffer);
        }
      }
      
      // Last resort - try direct conversion
      try {
        const buffer = Buffer.from(cachedEntry.data);
        return Readable.from(buffer);
      } catch (error) {
        throw new Error(`Failed to create stream from cached data: ${error.message}`);
      }
    } else {
      throw new Error('No cached data available for image.');
    }
  }

  return response.data;
}
