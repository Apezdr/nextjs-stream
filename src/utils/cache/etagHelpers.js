import crypto from 'crypto';

/**
 * Generate ETag from response data using MD5 hash
 * @param {Object|Array|string} data - The data to hash
 * @returns {string} ETag string with quotes (e.g., "abc123")
 */
export function generateETag(data) {
  const content = typeof data === 'string' ? data : JSON.stringify(data);
  const hash = crypto.createHash('md5').update(content, 'utf8').digest('hex');
  return `"${hash}"`;
}

/**
 * Check if the request has a matching ETag
 * @param {Request} request - The incoming request
 * @param {string} etag - The current ETag
 * @returns {boolean} True if ETags match (client has current version)
 */
export function hasMatchingETag(request, etag) {
  const ifNoneMatch = request.headers.get('if-none-match');
  if (!ifNoneMatch) return false;
  
  // Normalize ETags by removing W/ prefix for weak ETag comparison
  // CDNs like Cloudflare often convert strong ETags to weak ETags
  const normalizeETag = (tag) => tag.replace(/^W\//, '');
  
  return normalizeETag(ifNoneMatch) === normalizeETag(etag);
}

/**
 * Create a 304 Not Modified response with ETag
 * @param {string} etag - The ETag to include in headers
 * @returns {Response} 304 response
 */
export function createNotModifiedResponse(etag) {
  return new Response(null, {
    status: 304,
    headers: {
      'ETag': etag,
      'Cache-Control': 'no-cache'
    }
  });
}

/**
 * Create standard cache headers for no-cache with ETag revalidation
 * @param {string} etag - The ETag to include
 * @returns {Object} Headers object
 */
export function createCacheHeaders(etag) {
  return {
    'ETag': etag,
    'Cache-Control': 'no-cache' // Client must revalidate but can use 304 response
  };
}
