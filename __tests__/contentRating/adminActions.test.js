const getSession = jest.fn()
const findOne = jest.fn()
const updateOne = jest.fn()
const collection = jest.fn(() => ({ findOne, updateOne }))
const revalidatePath = jest.fn()
const invalidateMovieDetailsCache = jest.fn()
const invalidateTVShowDetailsCache = jest.fn()

jest.mock('mongodb', () => ({
  ObjectId: class ObjectId {
    constructor(value = 'generated-id') {
      this.value = value
    }
    static isValid(value) {
      return typeof value === 'string' && value.length > 0
    }
    toString() {
      return this.value
    }
  },
}))

jest.mock('next/cache', () => ({ revalidatePath: (...args) => revalidatePath(...args) }))
jest.mock('@src/lib/cachedAuth', () => ({ getSession: (...args) => getSession(...args) }))
jest.mock('@src/utils/config', () => ({ adminUserEmails: ['admin@example.test'] }))
jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({ db: () => ({ collection }) }),
}))
jest.mock('@src/utils/flatDatabaseUtils', () => ({
  generateNormalizedVideoId: (value) => `normalized:${value}`,
}))
jest.mock('@src/utils/cache/invalidation', () => ({
  invalidateMovieDetailsCache: (...args) => invalidateMovieDetailsCache(...args),
  invalidateTVShowDetailsCache: (...args) => invalidateTVShowDetailsCache(...args),
  invalidateSeasonDetailsCache: jest.fn(),
  invalidateEpisodeDetailsCache: jest.fn(),
}))

import {
  saveMovieAction,
  saveTVShowAction,
} from '@src/utils/admin/flatMediaActions'

describe('admin content-rating actions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getSession.mockResolvedValue({ user: { email: 'admin@example.test' } })
    findOne.mockResolvedValue({
      _id: 'existing-id',
      title: 'Example',
      originalTitle: 'Example',
      videoURL: '/example.mp4',
    })
    updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
  })

  test('rejects a direct unauthenticated movie action before database access', async () => {
    getSession.mockResolvedValue(null)

    const result = await saveMovieAction({}, {
      id: 'movie-1',
      contentRatingIntent: 'set',
      contentRatingCode: 'PG-13',
      provider: 'tmdb',
      source: 'TMDB',
      descriptors: ['Injected descriptor'],
      reason: 'Injected reason',
      lockedFields: { contentRating: true },
    })

    expect(result).toEqual({ status: 'error', message: 'Not authorized.' })
    expect(collection).not.toHaveBeenCalled()
    expect(updateOne).not.toHaveBeenCalled()
  })

  test('stores a validated manual movie rating and lock in one update', async () => {
    const result = await saveMovieAction({}, {
      id: 'movie-1',
      contentRatingIntent: 'set',
      contentRatingCode: 'PG-13',
      contentRatingDescriptors: ['Nudity', 'Strong Language'],
      descriptors: ['Injected top-level descriptor'],
      lockedFields: { contentRating: true },
    })

    expect(result.status).toBe('success')
    expect(updateOne).toHaveBeenCalledTimes(1)
    expect(updateOne.mock.calls[0][1].$set).toEqual(expect.objectContaining({
      contentRatingOverride: expect.objectContaining({
        contentRating: 'PG-13',
        provider: 'manual',
        source: 'Manual',
        descriptors: ['Nudity', 'Strong Language'],
        reason: null,
      }),
      'manualFields.contentRating': true,
      lockedFields: { contentRating: true },
      updatedAt: expect.any(Date),
    }))
    expect(invalidateMovieDetailsCache).toHaveBeenCalledWith('Example')
  })

  test('stores locked suppression as null without fabricating a rating', async () => {
    await saveMovieAction({}, {
      id: 'movie-1',
      contentRatingIntent: 'suppress',
      contentRatingCode: '',
      lockedFields: { contentRating: true },
    })

    expect(updateOne.mock.calls[0][1].$set).toEqual(expect.objectContaining({
      contentRatingOverride: null,
      'manualFields.contentRating': true,
      lockedFields: { contentRating: true },
    }))
  })

  test('ignores top-level descriptor injection without the dedicated payload field', async () => {
    await saveMovieAction({}, {
      id: 'movie-1',
      contentRatingIntent: 'set',
      contentRatingCode: 'R',
      descriptors: ['Injected descriptor'],
      lockedFields: { contentRating: true },
    })

    expect(updateOne.mock.calls[0][1].$set.contentRatingOverride.descriptors).toEqual([])
  })

  test('unlocking atomically removes the override, manual marker, and lock', async () => {
    await saveMovieAction({}, {
      id: 'movie-1',
      contentRatingIntent: 'automatic',
      contentRatingCode: '',
      lockedFields: {},
    })

    expect(updateOne.mock.calls[0][1].$unset).toEqual({
      contentRatingOverride: '',
      'manualFields.contentRating': '',
      lockedFields: '',
    })
  })

  test('rejects movie ratings for television without writing', async () => {
    const result = await saveTVShowAction({}, {
      id: 'show-1',
      contentRatingIntent: 'set',
      contentRatingCode: 'R',
      lockedFields: { contentRating: true },
    })

    expect(result).toEqual({
      status: 'error',
      message: 'Invalid content rating selection.',
    })
    expect(updateOne).not.toHaveBeenCalled()
  })

  test('stores a validated manual television rating', async () => {
    await saveTVShowAction({}, {
      id: 'show-1',
      contentRatingIntent: 'set',
      contentRatingCode: 'TV-MA',
      lockedFields: { contentRating: true },
    })

    expect(updateOne.mock.calls[0][1].$set.contentRatingOverride).toEqual(
      expect.objectContaining({
        contentRating: 'TV-MA',
        mediaType: 'tv',
        provider: 'manual',
      })
    )
    expect(invalidateTVShowDetailsCache).toHaveBeenCalledWith('Example')
  })
})
