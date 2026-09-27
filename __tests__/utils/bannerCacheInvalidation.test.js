/**
 * @jest-environment node
 *
 * The /list banner query is cached and kept fresh by expiring its tag wherever
 * movies change. The expiry must be { expire: 0 }: with 'max' the next banner
 * poll (every 4 s) would still get the old list while it refreshed.
 */

const mockRevalidateTag = jest.fn()
jest.mock('next/cache', () => ({
  revalidateTag: (...args) => mockRevalidateTag(...args),
  updateTag: jest.fn(),
}))

const {
  expireBannerCache,
  invalidateMovieDetailsCache,
  invalidateTVShowDetailsCache,
} = require('@src/utils/cache/invalidation')

beforeEach(() => {
  mockRevalidateTag.mockReset()
  jest.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  console.log.mockRestore()
})

it('expires the banner tag outright', () => {
  expect(expireBannerCache()).toBe(true)
  expect(mockRevalidateTag).toHaveBeenCalledWith('banner', { expire: 0 })
})

it('expires the banner on every admin movie edit', async () => {
  await invalidateMovieDetailsCache('Heat')

  expect(mockRevalidateTag).toHaveBeenCalledWith('banner', { expire: 0 })
  // The movie's own pages keep stale-while-revalidate
  expect(mockRevalidateTag).toHaveBeenCalledWith('movies', 'max')
})

it('leaves the banner alone for TV edits', async () => {
  await invalidateTVShowDetailsCache('Severance')
  expect(mockRevalidateTag).not.toHaveBeenCalledWith('banner', expect.anything())
})

it('never throws, even where revalidateTag does', () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
  mockRevalidateTag.mockImplementation(() => {
    throw new Error('revalidateTag outside a request')
  })

  expect(expireBannerCache()).toBe(false)
  consoleError.mockRestore()
})
