const toArray = jest.fn().mockResolvedValue([])
const find = jest.fn(() => ({ toArray }))
const collection = jest.fn(() => ({ find }))
const fetchTmdbFromBackend = jest.fn()

jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({
    db: () => ({ collection }),
  }),
}))

jest.mock('@src/utils/tmdb/backendClient', () => ({
  fetchTmdbFromBackend: (...args) => fetchTmdbFromBackend(...args),
}))

import { batchResolveMedia } from '@src/utils/watchlist/mediaResolver'

describe('watchlist comprehensive content-rating integration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    toArray.mockResolvedValue([])
    jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    console.log.mockRestore()
  })

  test('normalizes the existing comprehensive response without another provider request', async () => {
    fetchTmdbFromBackend.mockResolvedValue({
      data: {
        id: 123,
        title: 'Example Movie',
        release_dates: {
          results: [
            {
              iso_3166_1: 'US',
              release_dates: [
                {
                  certification: 'R',
                  type: 3,
                  release_date: '2024-01-01T00:00:00.000Z',
                  descriptors: ['Language'],
                },
              ],
            },
          ],
        },
      },
      headers: { etag: '"fixture"' },
    })

    const result = await batchResolveMedia([
      { tmdbId: 123, mediaType: 'movie' },
    ], { authHeaders: { Authorization: 'Bearer test-placeholder' } })

    expect(fetchTmdbFromBackend).toHaveBeenCalledTimes(1)
    expect(fetchTmdbFromBackend).toHaveBeenCalledWith(
      'comprehensive/movie',
      { blurhash: 'true', tmdb_id: 123 },
      { authHeaders: { Authorization: 'Bearer test-placeholder' } }
    )
    expect(result.get(123).contentRating).toEqual(expect.objectContaining({
      contentRating: 'R',
      provider: 'tmdb',
      descriptors: ['Language'],
    }))
  })
})
