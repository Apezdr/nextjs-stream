import {
  MOVIE_CONTENT_RATINGS,
  isSupportedContentRating,
} from '@src/utils/contentRating'

export const CONTENT_RATING_BADGE_VERSION = 1

const BADGE_HEIGHT = 40
const BADGE_WIDTHS = Object.freeze({
  G: 48,
  PG: 54,
  'PG-13': 76,
  R: 48,
  'NC-17': 76,
  NR: 54,
  'TV-Y': 66,
  'TV-Y7': 72,
  'TV-Y7-FV': 98,
  'TV-G': 66,
  'TV-PG': 76,
  'TV-14': 76,
  'TV-MA': 80,
})

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function getContentRatingBadgeDimensions(contentRating) {
  if (!isSupportedContentRating(contentRating)) return null
  return { width: BADGE_WIDTHS[contentRating], height: BADGE_HEIGHT }
}

export function generateContentRatingSvg(contentRating) {
  const dimensions = getContentRatingBadgeDimensions(contentRating)
  if (!dimensions) return null

  const { width, height } = dimensions
  const escapedRating = escapeXml(contentRating)
  const systemDescription = MOVIE_CONTENT_RATINGS.includes(contentRating)
    ? 'United States motion picture content rating'
    : 'United States television content rating'
  const fontSize = contentRating.length >= 8 ? 13 : contentRating.length >= 5 ? 15 : 17

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <title>Rated ${escapedRating}</title>
  <desc>${systemDescription} ${escapedRating}</desc>
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="5" fill="#111827" stroke="#ffffff" stroke-width="2"/>
  <rect x="4" y="4" width="${width - 8}" height="${height - 8}" rx="3" fill="none" stroke="#9ca3af" stroke-width="1"/>
  <text x="${width / 2}" y="25" fill="#ffffff" font-family="sans-serif" font-size="${fontSize}" font-weight="700" letter-spacing="0" text-anchor="middle">${escapedRating}</text>
</svg>`
}
