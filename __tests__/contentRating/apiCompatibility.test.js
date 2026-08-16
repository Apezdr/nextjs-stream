import { sanitizeTVData } from '@src/utils/auth_utils'

describe('content-rating API compatibility', () => {
  test('keeps the legacy rating string and adds the normalized object for old clients and new clients', () => {
    const result = sanitizeTVData({
      id: 'show-1',
      title: 'Example Show',
      type: 'tv',
      metadata: {
        rating: 'TV-14',
        overview: 'Example overview',
      },
    }, { mediaType: 'tv' })

    expect(result.metadata.rating).toBe('TV-14')
    expect(result.contentRating).toEqual({
      contentRating: 'TV-14',
      country: 'US',
      system: 'TV Parental Guidelines',
      mediaType: 'tv',
      descriptors: [],
      reason: null,
      source: 'TMDB',
      provider: 'legacy',
    })
  })

  test('prefers a valid normalized object without duplicating or retyping the legacy field', () => {
    const result = sanitizeTVData({
      id: 'show-2',
      title: 'Example Show',
      type: 'tv',
      contentRating: {
        contentRating: 'TV-MA',
        country: 'US',
        system: 'TV Parental Guidelines',
        mediaType: 'tv',
        descriptors: ['Strong Language'],
        reason: null,
        source: 'TMDB',
      },
      metadata: { rating: 'TV-MA' },
    }, { mediaType: 'tv' })

    expect(result.metadata.rating).toBe('TV-MA')
    expect(result.contentRating.descriptors).toEqual(['Strong Language'])
  })

  test('keeps the response structurally valid when optional rating metadata is malformed or absent', () => {
    const malformed = sanitizeTVData({
      id: 'show-3',
      title: 'Example Show',
      type: 'tv',
      contentRating: { contentRating: '<script>' },
      metadata: { rating: 14 },
    }, { mediaType: 'tv' })
    const absent = sanitizeTVData({
      id: 'show-4',
      title: 'Example Show',
      type: 'tv',
      metadata: {},
    }, { mediaType: 'tv' })

    expect(malformed.contentRating).toBeNull()
    expect(absent.contentRating).toBeNull()
    expect(absent.title).toBe('Example Show')
  })

  test('preserves explicit show-level suppression instead of resurrecting the legacy scalar', () => {
    const result = sanitizeTVData({
      id: 'show-5',
      title: 'Example Show',
      type: 'tv',
      contentRatingOverride: null,
      contentRating: null,
      metadata: { rating: 'TV-MA' },
    }, { mediaType: 'tv' })

    expect(result.metadata.rating).toBe('TV-MA')
    expect(result.contentRating).toBeNull()
  })
})
