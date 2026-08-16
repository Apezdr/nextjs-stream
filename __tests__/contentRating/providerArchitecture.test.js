import {
  CONTENT_RATING_PROVIDERS,
  normalizeContentRating,
  resolveContentRatingCandidates,
  resolveContentRatingWithProviders,
} from '@src/utils/contentRating'
import { tmdbContentRatingProvider } from '@src/utils/contentRatingTmdbProvider'
import { generateContentRatingSvg } from '@src/utils/contentRatingSvg'

const moviePayload = {
  results: [
    {
      iso_3166_1: 'US',
      release_dates: [
        {
          certification: 'PG-13',
          type: 3,
          release_date: '2024-01-01T00:00:00.000Z',
          descriptors: ['Violence'],
        },
      ],
    },
  ],
}

describe('content-rating provider architecture', () => {
  test('registers TMDB as the only active immutable provider', () => {
    expect(Object.isFrozen(CONTENT_RATING_PROVIDERS)).toBe(true)
    expect(CONTENT_RATING_PROVIDERS).toEqual([tmdbContentRatingProvider])
    expect(tmdbContentRatingProvider.id).toBe('tmdb')
  })

  test('TMDB adapter preserves the existing movie selection result', () => {
    expect(tmdbContentRatingProvider.getContentRating({
      mediaType: 'movie',
      metadata: { release_dates: moviePayload },
      externalIds: { tmdb: '123' },
    })).toEqual({
      contentRating: 'PG-13',
      country: 'US',
      system: 'MPA',
      mediaType: 'movie',
      descriptors: ['Violence'],
      reason: null,
      source: 'TMDB',
      provider: 'tmdb',
    })
  })

  test('TMDB adapter preserves the existing television selection result', () => {
    expect(tmdbContentRatingProvider.getContentRating({
      mediaType: 'tv',
      metadata: {
        content_ratings: {
          results: [
            { iso_3166_1: 'GB', rating: '18' },
            { iso_3166_1: 'US', rating: 'TV-MA', descriptors: ['Language'] },
          ],
        },
      },
      externalIds: { tmdb: '456' },
    })).toEqual({
      contentRating: 'TV-MA',
      country: 'US',
      system: 'TV Parental Guidelines',
      mediaType: 'tv',
      descriptors: ['Language'],
      reason: null,
      source: 'TMDB',
      provider: 'tmdb',
    })
  })

  test('normalization is provider-neutral while retaining the legacy source field', () => {
    expect(normalizeContentRating({
      contentRating: 'PG-13',
      country: 'US',
      system: 'MPA',
      mediaType: 'movie',
      descriptors: [],
      reason: null,
      source: 'LICENSED',
      provider: 'licensed-provider',
    })).toEqual({
      contentRating: 'PG-13',
      country: 'US',
      system: 'MPA',
      mediaType: 'movie',
      descriptors: [],
      reason: null,
      source: 'LICENSED',
      provider: 'licensed-provider',
    })
  })

  test('legacy scalar provenance is explicit without retyping the compatibility source', () => {
    expect(normalizeContentRating('R', 'movie')).toEqual({
      contentRating: 'R',
      country: 'US',
      system: 'MPA',
      mediaType: 'movie',
      descriptors: [],
      reason: null,
      source: 'TMDB',
      provider: 'legacy',
    })
  })

  test('candidate resolver returns null when no valid candidate exists', () => {
    expect(resolveContentRatingCandidates([], 'movie')).toBeNull()
    expect(resolveContentRatingCandidates([
      { contentRating: '12A', country: 'GB', mediaType: 'movie' },
    ], 'movie')).toBeNull()
  })

  test('candidate resolver skips incompatible country and system data', () => {
    const result = resolveContentRatingCandidates([
      {
        contentRating: 'PG-13',
        country: 'GB',
        system: 'MPA',
        mediaType: 'movie',
        provider: 'first-provider',
      },
      {
        contentRating: 'PG-13',
        country: 'US',
        system: 'TV Parental Guidelines',
        mediaType: 'movie',
        provider: 'second-provider',
      },
      {
        contentRating: 'PG-13',
        country: 'US',
        system: 'MPA',
        mediaType: 'movie',
        provider: 'third-provider',
      },
    ], 'movie')

    expect(result?.provider).toBe('third-provider')
  })

  test('candidate resolver never combines descriptors across incompatible ratings', () => {
    const result = resolveContentRatingCandidates([
      {
        contentRating: 'PG-13',
        country: 'US',
        system: 'MPA',
        mediaType: 'movie',
        descriptors: [],
        provider: 'preferred-provider',
      },
      {
        contentRating: 'R',
        country: 'US',
        system: 'MPA',
        mediaType: 'movie',
        descriptors: ['Strong Violence'],
        provider: 'fallback-provider',
      },
    ], 'movie')

    expect(result?.contentRating).toBe('PG-13')
    expect(result?.descriptors).toEqual([])
  })

  test('provider failure remains non-fatal and reaches the legacy fallback', () => {
    const result = resolveContentRatingWithProviders({
      metadata: { rating: 'PG' },
    }, 'movie', [
      {
        id: 'unavailable-provider',
        getContentRating() {
          throw new Error('provider unavailable')
        },
      },
    ])

    expect(result?.contentRating).toBe('PG')
    expect(result?.provider).toBe('legacy')
  })

  test('provider context reuses existing external IDs without exposing them in the rating', () => {
    let receivedContext = null
    const result = resolveContentRatingWithProviders({
      tmdbId: 123,
      imdbId: 'tt1234567',
      metadata: { rating: 'R', tvdb_id: 456 },
    }, 'movie', [
      {
        id: 'context-probe',
        getContentRating(context) {
          receivedContext = context
          return null
        },
      },
    ])

    expect(receivedContext.externalIds).toEqual({
      tmdb: '123',
      imdb: 'tt1234567',
      tvdb: '456',
    })
    expect(result).not.toHaveProperty('externalIds')
  })

  test('SVG generation depends on the resolved code and not its provider', () => {
    const tmdb = normalizeContentRating({
      contentRating: 'PG-13',
      mediaType: 'movie',
      provider: 'tmdb',
      source: 'TMDB',
    })
    const licensed = normalizeContentRating({
      contentRating: 'PG-13',
      mediaType: 'movie',
      provider: 'licensed-provider',
      source: 'LICENSED',
    })

    expect(generateContentRatingSvg(tmdb.contentRating)).toBe(
      generateContentRatingSvg(licensed.contentRating)
    )
  })
})
