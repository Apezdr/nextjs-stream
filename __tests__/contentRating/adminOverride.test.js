import {
  prepareContentRatingOverrideUpdate,
} from '@src/utils/admin/contentRatingOverride'
import {
  getContentRatingForDisplay,
  isContentRatingSuppressed,
  resolveContentRating,
} from '@src/utils/contentRating'

describe('admin content-rating override state machine', () => {
  test('persists a canonical manual movie rating while locked', () => {
    expect(prepareContentRatingOverrideUpdate({
      contentRatingIntent: 'set',
      contentRatingCode: 'pg13',
      lockedFields: { contentRating: true },
    }, 'movie', { isCreate: false })).toEqual({
      error: null,
      set: {
        contentRatingOverride: {
          contentRating: 'PG-13',
          country: 'US',
          system: 'MPA',
          mediaType: 'movie',
          descriptors: [],
          reason: null,
          source: 'Manual',
          provider: 'manual',
        },
        'manualFields.contentRating': true,
      },
      unset: {},
    })
  })

  test('sanitizes, deduplicates, bounds, and persists explicit manual descriptors', () => {
    const result = prepareContentRatingOverrideUpdate({
      contentRatingIntent: 'set',
      contentRatingCode: 'R',
      contentRatingDescriptors: [
        ' Nudity ',
        'nudity',
        '<strong>Language</strong>',
        ...Array.from({ length: 10 }, (_, index) => `Descriptor ${index}`),
      ],
      lockedFields: { contentRating: true },
    }, 'movie', { isCreate: false })

    expect(result.error).toBeNull()
    expect(result.set.contentRatingOverride.descriptors).toEqual([
      'Nudity',
      'Descriptor 0',
      'Descriptor 1',
      'Descriptor 2',
      'Descriptor 3',
      'Descriptor 4',
      'Descriptor 5',
      'Descriptor 6',
    ])
  })

  test('persists descriptor removal as an empty array', () => {
    const result = prepareContentRatingOverrideUpdate({
      contentRatingIntent: 'set',
      contentRatingCode: 'R',
      contentRatingDescriptors: [],
      lockedFields: { contentRating: true },
    }, 'movie', { isCreate: false })

    expect(result.set.contentRatingOverride.descriptors).toEqual([])
  })

  test('rejects malformed descriptor payloads only for a manual set', () => {
    expect(prepareContentRatingOverrideUpdate({
      contentRatingIntent: 'set',
      contentRatingCode: 'R',
      contentRatingDescriptors: 'Nudity',
      lockedFields: { contentRating: true },
    }, 'movie', { isCreate: false }).error).toBe('Invalid content rating selection.')

    expect(prepareContentRatingOverrideUpdate({
      contentRatingIntent: 'suppress',
      contentRatingCode: '',
      contentRatingDescriptors: ['Ignored'],
      lockedFields: { contentRating: true },
    }, 'movie', { isCreate: false }).set.contentRatingOverride).toBeNull()
  })

  test('persists an explicit locked suppression without inventing NR', () => {
    expect(prepareContentRatingOverrideUpdate({
      contentRatingIntent: 'suppress',
      contentRatingCode: '',
      lockedFields: { contentRating: true },
    }, 'tv', { isCreate: false })).toEqual({
      error: null,
      set: {
        contentRatingOverride: null,
        'manualFields.contentRating': true,
      },
      unset: {},
    })
  })

  test('unlocking removes the override and resumes automatic resolution', () => {
    expect(prepareContentRatingOverrideUpdate({
      contentRatingIntent: 'automatic',
      contentRatingCode: '',
      lockedFields: {},
    }, 'movie', { isCreate: false })).toEqual({
      error: null,
      set: {},
      unset: {
        contentRatingOverride: '',
        'manualFields.contentRating': '',
      },
    })
  })

  test.each([
    [{ contentRatingIntent: 'set', contentRatingCode: 'TV-MA', lockedFields: { contentRating: true } }, 'movie'],
    [{ contentRatingIntent: 'set', contentRatingCode: 'R', lockedFields: { contentRating: true } }, 'tv'],
    [{ contentRatingIntent: 'set', contentRatingCode: 'PG-13', lockedFields: {} }, 'movie'],
    [{ contentRatingIntent: 'automatic', contentRatingCode: '', lockedFields: { contentRating: true } }, 'movie'],
    [{ contentRatingIntent: 'unexpected', contentRatingCode: 'R', lockedFields: {} }, 'movie'],
  ])('rejects invalid or contradictory intent %#', (payload, mediaType) => {
    const result = prepareContentRatingOverrideUpdate(payload, mediaType, { isCreate: false })
    expect(result.error).toBe('Invalid content rating selection.')
    expect(result.set).toEqual({})
    expect(result.unset).toEqual({})
  })
})

describe('content-rating override resolution', () => {
  const metadata = {
    rating: 'R',
    release_dates: {
      results: [{
        iso_3166_1: 'US',
        release_dates: [{
          certification: 'PG-13',
          type: 3,
          release_date: '2024-01-01T00:00:00.000Z',
          descriptors: ['Violence'],
        }],
      }],
    },
  }

  test('manual override wins atomically over provider metadata', () => {
    const result = resolveContentRating({
      contentRatingOverride: {
        contentRating: 'PG',
        mediaType: 'movie',
        provider: 'manual',
        source: 'Manual',
      },
      metadata,
    }, 'movie')

    expect(result).toEqual(expect.objectContaining({
      contentRating: 'PG',
      provider: 'manual',
      source: 'Manual',
      descriptors: [],
      reason: null,
    }))
  })

  test('literal null suppresses provider and legacy fallback ratings', () => {
    const media = { contentRatingOverride: null, metadata }
    expect(resolveContentRating(media, 'movie')).toBeNull()
    expect(isContentRatingSuppressed(media)).toBe(true)
  })

  test('absent or malformed override preserves the existing provider fallback', () => {
    expect(resolveContentRating({ metadata }, 'movie')?.contentRating).toBe('PG-13')
    expect(resolveContentRating({
      contentRatingOverride: { contentRating: '<script>' },
      metadata,
    }, 'movie')?.contentRating).toBe('PG-13')
  })

  test('presentation keeps historical fallback but never resurrects a suppressed rating', () => {
    expect(getContentRatingForDisplay({ contentRating: null }, 'R')).toBe('R')
    expect(getContentRatingForDisplay({
      contentRatingOverride: null,
      contentRating: null,
    }, 'R')).toBeNull()
  })
})
