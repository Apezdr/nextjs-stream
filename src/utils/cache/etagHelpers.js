import crypto from 'crypto';

/*
 * ETags here are WEAK on purpose, and matching tolerates what proxies do to them.
 *
 * Proxies that compress responses rewrite ETags, and every host runs its own:
 *   - Caddy's `encode` appends "-gzip"/"-zstd" to a STRONG ETag, and removes
 *     it from If-None-Match again only while the value is still strong.
 *   - Cloudflare turns a strong ETag weak (or drops it) whenever it
 *     re-compresses a response, and drops malformed (unquoted) ETags outright.
 *   - nginx's gzip, CloudFront and Varnish weaken strong ETags.
 *   - Apache's mod_deflate appends "-gzip" to strong AND weak ETags and never
 *     removes it from If-None-Match; Jetty appends "--gzip".
 *
 * Behind Cloudflare + Caddy a strong ETag reached browsers as W/"<hash>-gzip",
 * which Caddy would not un-suffix, so not one browser poll got a 304. A weak
 * ETag is left alone by Caddy, Cloudflare and nginx, and costs nothing here:
 * If-None-Match always compares weakly (RFC 9110 §13.1.2). Matching then
 * ignores the W/ prefix and any content-coding suffix, which covers
 * mod_deflate, Jetty and any proxy that still rewrites the value.
 */

/**
 * Generate a weak ETag from response data using an MD5 hash
 * @param {Object|Array|string} data - The data to hash
 * @returns {string} Weak ETag (e.g., W/"abc123")
 */
export function generateETag(data) {
  const content = typeof data === 'string' ? data : JSON.stringify(data);
  const hash = crypto.createHash('md5').update(content, 'utf8').digest('hex');
  return `W/"${hash}"`;
}

// Content-coding markers proxies append inside the quotes: "-gzip" (Caddy,
// Apache), "-zstd" (Caddy), "-br" (Apache mod_brotli), "--gzip" (Jetty)
const CODING_SUFFIX = /-{1,2}(?:gzip|zstd|br|deflate)$/;

/**
 * The comparable core of an entity-tag: no W/ prefix, no quotes and no
 * content-coding suffixes (removed repeatedly, in case proxies are stacked)
 * @param {string} entityTag
 * @returns {string}
 */
function opaqueTag(entityTag) {
  let tag = entityTag.trim().replace(/^W\//i, '');
  if (tag.length >= 2 && tag.startsWith('"') && tag.endsWith('"')) {
    tag = tag.slice(1, -1);
  }
  let previous;
  do {
    previous = tag;
    tag = tag.replace(CODING_SUFFIX, '');
  } while (tag !== previous);
  return tag;
}

/**
 * The entity-tags in an If-None-Match value. A quoted tag may itself contain
 * commas, so quoted tags are matched rather than split; a value with none
 * (an unquoted legacy ETag) falls back to comma-separated tokens.
 * @param {string} header
 * @returns {string[]}
 */
function listEntityTags(header) {
  const quoted = header.match(/(?:W\/)?"[^"]*"/gi);
  if (quoted) return quoted;
  return header.split(',').map((token) => token.trim()).filter(Boolean);
}

/**
 * Check if the request has a matching ETag
 * @param {Request} request - The incoming request
 * @param {string} etag - The current ETag
 * @returns {boolean} True if ETags match (client has current version)
 */
export function hasMatchingETag(request, etag) {
  const ifNoneMatch = request.headers.get('if-none-match');
  if (!ifNoneMatch || !etag) return false;
  // "*" matches any current representation (RFC 9110 §13.1.2)
  if (ifNoneMatch.trim() === '*') return true;

  const current = opaqueTag(etag);
  if (!current) return false;
  return listEntityTags(ifNoneMatch).some((tag) => opaqueTag(tag) === current);
}

/**
 * Create a 304 Not Modified response with ETag
 * @param {string} etag - The ETag to include in headers
 * @param {Object} [headers] - Headers the 200 would also have carried, such as
 *   its Cache-Control (a 304 should repeat them)
 * @returns {Response} 304 response
 */
export function createNotModifiedResponse(etag, headers = {}) {
  return new Response(null, {
    status: 304,
    headers: {
      'Cache-Control': 'no-cache',
      ...headers,
      'ETag': etag
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
