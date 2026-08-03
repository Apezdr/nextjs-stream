/**
 * Pure video-identity helpers — the single source of truth for
 * `normalizedVideoId` derivation across the entire system.
 *
 * CommonJS on purpose, with zero imports beyond Node's `crypto`:
 *  - `src/utils/flatDatabaseUtils.js` re-exports these for the app, but that
 *    module connects a real MongoClient at import time — tests and one-off
 *    scripts must be able to use the exact production hash without opening
 *    database sockets.
 *  - `scripts/*.js` are plain CommonJS Node and `require()` this file
 *    directly (no bundler aliases available there).
 *
 * Every writer and reader of WatchHistory / PlaybackPresence / Flat* identity
 * must agree on this computation. Do not fork or re-implement it.
 */

const crypto = require('crypto')

/**
 * Canonicalizes a JIT-transcoder stream pathname back to the source file's
 * pathname, so that identity is invariant to the delivery transport.
 *
 * Transcoder URL contract (jit-transcoder): the served manifest URL is
 *   /stream/<base64(source-relative-path)>/master.m3u8   (HLS)
 *   /stream/<base64(source-relative-path)>/manifest.mpd  (DASH)
 * where the base64 segment encodes the RAW (un-percent-encoded) file path
 * relative to the media root (e.g. "movies/Kingdom of Heaven/….mkv" — no
 * leading slash, literal spaces).
 *
 * Served file URLs, by contrast, are percent-encoded, and the direct-play
 * hash pipeline extracts its pathname via the WHATWG URL parser (which
 * percent-encodes spaces etc.). So the decoded segment must be re-serialized
 * THROUGH THE SAME PARSER — `new URL().pathname` — before hashing, or every
 * spaced/non-ASCII title forks identity between direct and JIT playback.
 * Serializer parity also makes edge cases ('#'/'?' truncation, stray '%')
 * behave identically in both flows, which is the actual invariant: not a
 * particular encoding, but BYTE-IDENTICAL serialization on both paths.
 *
 * The regex is deliberately exact (master.m3u8 / manifest.mpd, end-anchored):
 * variant playlists and segments are never reported as a playback videoId,
 * and any future change to the transcoder's URL shape must be mirrored here.
 *
 * MUST be called BEFORE any lowercasing — base64 is case-sensitive.
 *
 * Fail-closed: on any doubt (regex miss, garbage/truncated base64, invalid
 * UTF-8, control characters, absolute or slash-less decoded path) the input
 * pathname is returned unchanged, which is exactly the pre-canonicalization
 * behavior.
 *
 * @param {string} pathname - URL pathname (not yet lowercased)
 * @returns {string} The canonical source pathname, or the input unchanged
 */
function canonicalizeStreamPathname(pathname) {
  return canonicalizeStreamPathnameWith(pathname, whatwgSerializePath)
}

function whatwgSerializePath(decoded) {
  return new URL('http://x/' + decoded).pathname
}

function canonicalizeStreamPathnameWith(pathname, finalize) {
  if (typeof pathname !== 'string') return pathname

  const match = /^\/stream\/([A-Za-z0-9+/_-]+={0,2})\/(?:master\.m3u8|manifest\.mpd)$/.exec(
    pathname
  )
  if (!match) return pathname

  const segment = match[1]

  try {
    const decoded = Buffer.from(segment, 'base64').toString('utf8')

    // Round-trip guard: Node's base64 decoder never throws — it silently
    // skips invalid characters — so re-encode and compare (normalizing
    // url-safe alphabet and padding) to reject garbage or truncated input.
    const normalize = (s) => s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/g, '')
    const reencoded = Buffer.from(decoded, 'utf8').toString('base64')
    if (normalize(reencoded) !== normalize(segment)) return pathname

    // Printability guard: reject control characters and the U+FFFD
    // replacement character (invalid UTF-8 that survived the round-trip).
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001F\u007F\uFFFD]/.test(decoded)) return pathname

    // Path-shape guard: the transcoder encodes source-RELATIVE paths.
    if (!decoded || !decoded.includes('/') || decoded.startsWith('/')) return pathname

    return finalize(decoded)
  } catch (e) {
    return pathname
  }
}

/**
 * Generates a consistent hash identifier from a video URL.
 * Uses cryptographic hashing for reliability across different encoding variations.
 *
 * Pipeline: decode-until-stable → URL parse (YouTube-like hosts keep the full
 * href, everything else keeps only the pathname, with JIT stream pathnames
 * canonicalized to their source pathname) → lowercase → sha256 hex [0:16].
 *
 * @param {string} url - The original video URL
 * @returns {string} A hash string identifier
 */
function generateNormalizedVideoId(url) {
  return generateNormalizedVideoIdWith(url, canonicalizeStreamPathname)
}

function generateNormalizedVideoIdWith(url, canonicalize) {
  if (!url) return ''

  try {
    // Normalize URL before hashing to handle encoding variations
    let normalizedUrl = url

    // Decode URL-encoded characters to ensure consistent hashing
    // Keep decoding until fully decoded (handles multiple encoding levels)
    let previousUrl = ''
    while (previousUrl !== normalizedUrl) {
      previousUrl = normalizedUrl
      try {
        const decoded = decodeURIComponent(normalizedUrl)
        // Only accept the decode if it actually changed something
        if (decoded !== normalizedUrl) {
          normalizedUrl = decoded
        } else {
          break // Already fully decoded
        }
      } catch (e) {
        // Decode failed - URL is either malformed or already decoded
        break
      }
    }

    // Extract URL portions based on URL type
    try {
      const urlObj = new URL(normalizedUrl)

      // Detect if this is a true external service (YouTube, Vimeo, etc.)
      // vs an internal file server (even if served over HTTPS)
      const isYouTubeOrSimilar =
        urlObj.hostname.includes('youtube.com') ||
        urlObj.hostname.includes('youtu.be') ||
        urlObj.hostname.includes('vimeo.com') ||
        urlObj.hostname.includes('dailymotion.com')

      if (isYouTubeOrSimilar) {
        // Keep full URL for external video services to preserve video ID in query params
        // Example: youtube.com/watch?v=ABC123 vs youtube.com/watch?v=XYZ789
        normalizedUrl = urlObj.href
      } else {
        // For internal file servers, use just the pathname (strips protocol/hostname/port)
        // This handles different server URLs pointing to the same file
        // Example: http://server1/video.mp4 and https://server2/video.mp4 → same hash
        // JIT-transcoder stream pathnames are canonicalized to the source
        // file's pathname (base64 is case-sensitive, so this must happen
        // before the lowercasing below).
        normalizedUrl = canonicalize(urlObj.pathname)
      }
    } catch (e) {
      // If URL parsing fails, use the whole string (canonicalize defensively
      // in case a bare pathname was passed in)
      normalizedUrl = canonicalize(normalizedUrl)
    }

    // Convert to lowercase before hashing to ensure case-insensitive matching
    normalizedUrl = normalizedUrl.toLowerCase()

    // Use SHA-256 for hashing - a modern, reliable hash algorithm
    // We're not using this for security, just for consistent identifiers
    const hash = crypto.createHash('sha256')
    hash.update(normalizedUrl)

    // Return first 16 characters of hex digest - good balance of uniqueness vs length
    return hash.digest('hex').substring(0, 16)
  } catch (error) {
    console.error(`Error generating hash for URL: ${url}`, error)

    // Fallback: if crypto fails, use basic string manipulation
    // This should almost never happen, but just in case
    const fallbackStr = url.toLowerCase().replace(/[^a-z0-9]/g, '')
    return `fallback_${fallbackStr.substring(0, 10)}`
  }
}

module.exports = { generateNormalizedVideoId, canonicalizeStreamPathname }
