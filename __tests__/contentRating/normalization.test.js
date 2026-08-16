import {
  normalizeContentDescriptors,
  normalizeContentRating,
  normalizeContentRatingCode,
  resolveContentRating,
  selectUsMovieContentRating,
  selectUsTvContentRating,
} from '@src/utils/contentRating'
import { parseContentDescriptorInput } from '@src/utils/contentRatingSchema'

const movieRelease = (certification, type = 3, releaseDate = '2024-01-01T00:00:00.000Z', extras = {}) => ({
  certification,
  type,
  release_date: releaseDate,
  descriptors: [],
  ...extras,
})

const moviePayload = (usReleases, otherResults = []) => ({
  results: [
    ...otherResults,
    { iso_3166_1: 'US', release_dates: usReleases },
  ],
})

describe('content-rating normalization', () => {
  test.each([null, undefined, '', '   ', 13, {}, []])('rejects absent or malformed code %p', (value) => {
    expect(normalizeContentRatingCode(value, 'movie')).toBeNull()
  })

  test('normalizes recognized movie aliases without converting unknown values to NR', () => {
    expect(normalizeContentRatingCode(' pg13 ', 'movie')).toBe('PG-13')
    expect(normalizeContentRatingCode('nc 17', 'movie')).toBe('NC-17')
    expect(normalizeContentRatingCode('UNRATED', 'movie')).toBe('NR')
    expect(normalizeContentRatingCode('not rated', 'movie')).toBe('NR')
    expect(normalizeContentRatingCode('not_rated', 'movie')).toBe('NR')
    expect(normalizeContentRatingCode('unknown', 'movie')).toBeNull()
  })

  test('keeps movie and television systems distinct', () => {
    expect(normalizeContentRatingCode('PG-13', 'movie')).toBe('PG-13')
    expect(normalizeContentRatingCode('PG-13', 'tv')).toBeNull()
    expect(normalizeContentRatingCode('TV-14', 'tv')).toBe('TV-14')
    expect(normalizeContentRatingCode('TV-14', 'movie')).toBeNull()
  })

  test('preserves TV-Y7-FV and normalizes documented television formatting variants', () => {
    expect(normalizeContentRatingCode('tv-y7-fv', 'tv')).toBe('TV-Y7-FV')
    expect(normalizeContentRatingCode('TV Y7 FV', 'tv')).toBe('TV-Y7-FV')
    expect(normalizeContentRatingCode('tvma', 'tv')).toBe('TV-MA')
  })

  test('bounds and sanitizes provider descriptors without accepting markup', () => {
    const descriptors = normalizeContentDescriptors([
      ' Violence ',
      'violence',
      '',
      42,
      '<strong>Language</strong>',
      '&lt;em&gt;Encoded markup&lt;/em&gt;',
      'Strong\u0000Language',
      'Strong Language',
      ...Array.from({ length: 10 }, (_, index) => `Descriptor ${index}`),
    ])

    expect(descriptors).toEqual([
      'Violence',
      'Strong Language',
      'Descriptor 0',
      'Descriptor 1',
      'Descriptor 2',
      'Descriptor 3',
      'Descriptor 4',
      'Descriptor 5',
    ])
    expect(normalizeContentDescriptors(['x'.repeat(161)])).toEqual([])
  })

  test('parses descriptor text one line at a time without splitting legitimate commas', () => {
    expect(parseContentDescriptorInput('Violence, gore\r\n\n Nudity ')).toEqual([
      'Violence, gore',
      'Nudity',
    ])
    expect(parseContentDescriptorInput(null)).toEqual([])
  })

  test('creates the canonical movie and television contracts', () => {
    expect(normalizeContentRating('PG-13', 'movie')).toEqual({
      contentRating: 'PG-13',
      country: 'US',
      system: 'MPA',
      mediaType: 'movie',
      descriptors: [],
      reason: null,
      source: 'TMDB',
      provider: 'legacy',
    })
    expect(normalizeContentRating('TV-MA', 'tv')).toEqual({
      contentRating: 'TV-MA',
      country: 'US',
      system: 'TV Parental Guidelines',
      mediaType: 'tv',
      descriptors: [],
      reason: null,
      source: 'TMDB',
      provider: 'legacy',
    })
  })

  test('rejects conflicting provenance and remains total for hostile object properties', () => {
    expect(normalizeContentRating({
      contentRating: 'PG-13',
      mediaType: 'movie',
      source: 'Unknown Provider',
    })).toBeNull()

    const hostile = {}
    Object.defineProperty(hostile, 'mediaType', {
      get() {
        throw new Error('hostile getter')
      },
    })
    expect(() => normalizeContentRating(hostile)).not.toThrow()
    expect(normalizeContentRating(hostile)).toBeNull()
  })
})

describe('US movie certification selection', () => {
  test('selects one valid US theatrical certification', () => {
    expect(selectUsMovieContentRating(moviePayload([movieRelease('PG-13')]))?.contentRating).toBe('PG-13')
  })

  test('skips an empty higher-priority release and selects a valid lower-priority release', () => {
    const payload = moviePayload([
      movieRelease('', 3),
      movieRelease('PG', 4),
    ])

    expect(selectUsMovieContentRating(payload)?.contentRating).toBe('PG')
  })

  test('uses the verified release-type order 3, 2, 1, 4, 5, 6', () => {
    const payload = moviePayload([
      movieRelease('R', 6),
      movieRelease('PG', 5),
      movieRelease('G', 4),
      movieRelease('NC-17', 1),
      movieRelease('PG-13', 2),
      movieRelease('R', 3),
    ])

    expect(selectUsMovieContentRating(payload)?.contentRating).toBe('R')
  })

  test('breaks same-type ties by earliest release date and not provider array order', () => {
    const releases = [
      movieRelease('R', 3, '2024-05-01T00:00:00.000Z'),
      movieRelease('PG-13', 3, '2024-02-01T00:00:00.000Z'),
    ]

    expect(selectUsMovieContentRating(moviePayload(releases))?.contentRating).toBe('PG-13')
    expect(selectUsMovieContentRating(moviePayload([...releases].reverse()))?.contentRating).toBe('PG-13')
  })

  test('uses a canonical code tie-break when type and date are identical', () => {
    const releases = [
      movieRelease('R'),
      movieRelease('PG-13'),
    ]

    expect(selectUsMovieContentRating(moviePayload(releases))?.contentRating).toBe('PG-13')
    expect(selectUsMovieContentRating(moviePayload([...releases].reverse()))?.contentRating).toBe('PG-13')
  })

  test('selects US PG-13 instead of GB 12A and never falls back to a foreign rating', () => {
    const foreign = { iso_3166_1: 'GB', release_dates: [movieRelease('12A')] }
    expect(selectUsMovieContentRating(moviePayload([movieRelease('PG-13')], [foreign]))?.contentRating).toBe('PG-13')
    expect(selectUsMovieContentRating({ results: [foreign] })).toBeNull()
  })

  test.each([
    undefined,
    null,
    {},
    { results: [] },
    { results: [{ iso_3166_1: 'US' }] },
    { results: [{ iso_3166_1: 'US', release_dates: [null, {}, { certification: 42 }] }] },
    { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'PG-13' }] }] },
  ])('returns no rating for missing or malformed movie data %#', (payload) => {
    expect(selectUsMovieContentRating(payload)).toBeNull()
  })

  test('normalizes an explicit UNRATED certification but never turns absence into NR', () => {
    expect(selectUsMovieContentRating(moviePayload([movieRelease('UNRATED')]))?.contentRating).toBe('NR')
    expect(selectUsMovieContentRating(moviePayload([movieRelease('')]))).toBeNull()
  })

  test('preserves only descriptors from the selected release and never treats note as an official reason', () => {
    const result = selectUsMovieContentRating(moviePayload([
      movieRelease('PG-13', 3, '2024-01-01T00:00:00.000Z', {
        descriptors: [' Violence ', 'violence', 'Strong Language'],
        note: 'Festival premiere',
      }),
    ]))

    expect(result.descriptors).toEqual(['Violence', 'Strong Language'])
    expect(result.reason).toBeNull()
  })
})

describe('US television rating selection', () => {
  test.each(['TV-Y', 'TV-Y7', 'TV-G', 'TV-PG', 'TV-14', 'TV-MA', 'TV-Y7-FV'])(
    'selects supported US rating %s',
    (rating) => {
      const result = selectUsTvContentRating({
        results: [{ iso_3166_1: 'US', rating, descriptors: [] }],
      })
      expect(result?.contentRating).toBe(rating)
      expect(result?.system).toBe('TV Parental Guidelines')
    }
  )

  test('selects only the US value across multiple countries', () => {
    const payload = {
      results: [
        { iso_3166_1: 'GB', rating: '18' },
        { iso_3166_1: 'US', rating: 'TV-MA' },
      ],
    }
    expect(selectUsTvContentRating(payload)?.contentRating).toBe('TV-MA')
  })

  test.each([
    undefined,
    null,
    {},
    { results: [] },
    { results: [{ iso_3166_1: 'GB', rating: '18' }] },
    { results: [{ iso_3166_1: 'US', rating: '' }] },
    { results: [{ iso_3166_1: 'US', rating: 14 }] },
    { results: [{ iso_3166_1: 'US', rating: 'PG-13' }] },
  ])('returns no television rating for foreign, missing, malformed, or movie values %#', (payload) => {
    expect(selectUsTvContentRating(payload)).toBeNull()
  })

  test('selects deterministically when malformed duplicate US entries exist', () => {
    const entries = [
      { iso_3166_1: 'US', rating: '', descriptors: ['Ignored'] },
      { iso_3166_1: 'US', rating: 'TV-MA', descriptors: ['Language'] },
      { iso_3166_1: 'US', rating: 'TV-14', descriptors: ['Violence'] },
    ]

    expect(selectUsTvContentRating({ results: entries })?.contentRating).toBe('TV-14')
    expect(selectUsTvContentRating({ results: [...entries].reverse() })?.contentRating).toBe('TV-14')
  })
})

describe('content-rating source precedence and compatibility', () => {
  test('accepts old scalar data and new normalized objects', () => {
    expect(resolveContentRating({ metadata: { rating: 'PG-13' } }, 'movie')?.contentRating).toBe('PG-13')
    expect(resolveContentRating({
      contentRating: {
        contentRating: 'TV-14',
        country: 'US',
        system: 'TV Parental Guidelines',
        mediaType: 'tv',
        descriptors: ['Violence'],
        reason: 'Untrusted reason',
        source: 'TMDB',
      },
      metadata: { rating: 'TV-MA' },
    }, 'tv')).toEqual({
      contentRating: 'TV-14',
      country: 'US',
      system: 'TV Parental Guidelines',
      mediaType: 'tv',
      descriptors: ['Violence'],
      reason: null,
      source: 'TMDB',
      provider: 'tmdb',
    })
  })

  test.each(['G', 'PG', 'PG-13', 'R', 'NC-17', 'NR', 'TV-Y', 'TV-MA'])(
    'normalizing an already normalized %s rating is idempotent',
    (code) => {
      const mediaType = code.startsWith('TV-') ? 'tv' : 'movie'
      const first = normalizeContentRating(code, mediaType)
      expect(normalizeContentRating(first, mediaType)).toEqual(first)
    }
  )

  test('prefers valid normalized metadata, then raw provider data, then the legacy string', () => {
    const media = {
      contentRating: { contentRating: 'INVALID', mediaType: 'movie' },
      metadata: {
        contentRating: { contentRating: 'PG', mediaType: 'movie', descriptors: [] },
        release_dates: moviePayload([movieRelease('PG-13')]),
        rating: 'R',
      },
    }

    expect(resolveContentRating(media, 'movie')?.contentRating).toBe('PG')
  })

  test('falls back from malformed new and raw data to the usable legacy string', () => {
    const media = {
      contentRating: { contentRating: 'INVALID' },
      metadata: {
        release_dates: { results: [{ iso_3166_1: 'GB', release_dates: [movieRelease('12A')] }] },
        rating: 'PG-13',
      },
    }

    expect(resolveContentRating(media, 'movie')?.contentRating).toBe('PG-13')
  })

  test('ordinary optional metadata failures do not throw or fabricate a rating', () => {
    const media = {}
    Object.defineProperty(media, 'metadata', {
      get() {
        throw new Error('optional metadata unavailable')
      },
    })

    expect(() => resolveContentRating(media, 'movie')).not.toThrow()
    expect(resolveContentRating(media, 'movie')).toBeNull()
  })
})
