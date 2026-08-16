const findOne = jest.fn()
const collection = jest.fn(() => ({ findOne }))

jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({
    db: () => ({ collection }),
  }),
}))

jest.mock('mongodb', () => ({
  ObjectId: class ObjectId {
    static isValid() {
      return false
    }
  },
}))

import { getFlatRequestedMedia } from '@src/utils/flatDatabaseUtils'

describe('flat media content-rating integration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('adds the resolved TMDB movie rating using the existing Mongo read', async () => {
    findOne.mockResolvedValue({
      _id: { toString: () => 'movie-1' },
      title: 'Example Movie',
      originalTitle: 'Example Movie',
      metadata: {
        id: 123,
        release_dates: {
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
        },
      },
    })

    const result = await getFlatRequestedMedia({
      type: 'movie',
      title: 'Example Movie',
    })

    expect(collection).toHaveBeenCalledTimes(1)
    expect(collection).toHaveBeenCalledWith('FlatMovies')
    expect(findOne).toHaveBeenCalledTimes(1)
    expect(result.contentRating).toEqual(expect.objectContaining({
      contentRating: 'PG-13',
      provider: 'tmdb',
      source: 'TMDB',
      descriptors: ['Violence'],
    }))
  })

  test('propagates a show-level suppression into a season result', async () => {
    findOne
      .mockResolvedValueOnce({
        _id: { toString: () => 'show-1' },
        title: 'Example Show',
        originalTitle: 'Example Show',
        contentRatingOverride: null,
        metadata: { id: 456, rating: 'TV-MA' },
      })
      .mockResolvedValueOnce({
        _id: { toString: () => 'season-1' },
        showId: { toString: () => 'show-1' },
        seasonNumber: 1,
        metadata: {},
      })

    const result = await getFlatRequestedMedia({
      type: 'tv',
      title: 'Example Show',
      season: 'Season 1',
    })

    expect(collection).toHaveBeenCalledTimes(2)
    expect(result.contentRatingOverride).toBeNull()
    expect(result.contentRating).toBeNull()
  })
})
