/**
 * A watchlist title TMDB no longer has used to show as "Unknown Title". The
 * resolver now labels it, from the media processor's 404 with code
 * TMDB_NOT_FOUND, and only from that.
 */
import {
  TMDB_MISSING_TITLE,
  asResolvedMedia,
  isTmdbNotFound,
  missingFromTmdbMedia,
  untitledLabel,
} from '@src/utils/watchlist/tmdbMissing'

// The shape httpGet throws for a non-2xx answer
const statusError = (statusCode, body = '') =>
  Object.assign(new Error(`HTTP Error: ${statusCode}`), {
    statusCode,
    response: { statusCode, headers: {}, body },
  })

describe('isTmdbNotFound', () => {
  it("is true for the media processor's not-found answer", () => {
    expect(isTmdbNotFound(statusError(404, '{"error":"No tv with id 275188","code":"TMDB_NOT_FOUND"}'))).toBe(true)
  })

  it('is false for a 404 without the code, which says nothing about the title', () => {
    expect(isTmdbNotFound(statusError(404, 'Cannot GET /api/tmdb/comprehensive/tv'))).toBe(false)
    expect(isTmdbNotFound(statusError(404, '{"error":"Not found"}'))).toBe(false)
    expect(isTmdbNotFound(statusError(404))).toBe(false)
  })

  it('is false for other failures, which a later load can retry', () => {
    expect(isTmdbNotFound(statusError(502, '{"error":"TMDB is down","code":"TMDB_UNAVAILABLE"}'))).toBe(false)
    expect(isTmdbNotFound(statusError(400, '{"error":"Bad request"}'))).toBe(false)
    expect(isTmdbNotFound(new Error('socket hang up'))).toBe(false)
    expect(isTmdbNotFound(undefined)).toBe(false)
  })
})

describe('missingFromTmdbMedia', () => {
  it('labels the title and keeps what identifies it', () => {
    expect(TMDB_MISSING_TITLE).toBe('No longer on TMDB')
    expect(missingFromTmdbMedia(275188, 'tv')).toMatchObject({
      tmdbId: 275188,
      mediaType: 'tv',
      title: TMDB_MISSING_TITLE,
      tmdbNotFound: true,
      posterURL: '/sorry-image-not-available.jpg',
      isExternal: true,
      isAvailable: false,
      url: null,
      link: null,
    })
  })
})

describe('reading a resolver entry', () => {
  const placeholder = missingFromTmdbMedia(275188, 'tv')
  const media = { tmdbId: 603, mediaType: 'movie', title: 'The Matrix' }

  it('treats the placeholder as unresolved, so the fallbacks use what the item stored', () => {
    expect(asResolvedMedia(placeholder)).toBeNull()
    expect(asResolvedMedia(media)).toBe(media)
    expect(asResolvedMedia(undefined)).toBeNull()
  })

  it('labels an item with no title of its own', () => {
    expect(untitledLabel(placeholder)).toBe('No longer on TMDB')
    expect(untitledLabel(undefined)).toBe('Unknown Title')
  })
})
