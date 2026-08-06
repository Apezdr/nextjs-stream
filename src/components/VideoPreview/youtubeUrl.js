/**
 * URL helpers for YouTube trailer/clip sources stored on `metadata.trailer_url`.
 * Pure functions — safe to import from server or client code.
 */

const YT_ID = '([a-zA-Z0-9_-]{11})'

const YT_PATTERNS = [
  new RegExp(`youtube\\.com/watch\\?.*\\bv=${YT_ID}`),
  new RegExp(`youtu\\.be/${YT_ID}`),
  new RegExp(`youtube\\.com/embed/${YT_ID}`),
  new RegExp(`youtube\\.com/shorts/${YT_ID}`),
  new RegExp(`youtube-nocookie\\.com/embed/${YT_ID}`),
]

/**
 * Extract the 11-character YouTube video id from any common URL shape.
 * Returns null when the URL is not a YouTube link.
 */
export function extractYouTubeId(url) {
  if (typeof url !== 'string' || !url) return null
  for (const pattern of YT_PATTERNS) {
    const match = url.match(pattern)
    if (match) return match[1]
  }
  return null
}

export function isYouTubeUrl(url) {
  return extractYouTubeId(url) !== null
}
