/**
 * @jest-environment node
 */
/**
 * A watchlist title TMDB no longer has keeps the title and poster its item
 * stored when it was added. Only an item with no title of its own shows the
 * "No longer on TMDB" label, where it used to show "Unknown Title".
 */

jest.mock('@src/lib/mongodb', () => {
  // Nothing in the library, nothing marked coming soon
  const collection = () => ({ find: () => ({ toArray: async () => [] }) })
  return { __esModule: true, default: Promise.resolve({ db: () => ({ collection }) }) }
})
jest.mock('@src/lib/cachedAuth.js', () => ({ getSession: jest.fn() }))
jest.mock('@src/lib/userQueries', () => ({ userQueries: {} }))

const mockBatchResolveMedia = jest.fn()
jest.mock('@src/utils/watchlist/mediaResolver.js', () => ({
  batchResolveMedia: (...args) => mockBatchResolveMedia(...args),
  getMediaByTMDBId: jest.fn(),
}))

const { getMinimalCardDataForPlaylist } = require('@src/utils/watchlist/database')
const { missingFromTmdbMedia } = require('@src/utils/watchlist/tmdbMissing')

const item = (tmdbId, stored = {}) => ({
  _id: `item-${tmdbId}`,
  tmdbId,
  mediaType: 'tv',
  dateAdded: new Date('2026-09-01'),
  ...stored,
})

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => jest.restoreAllMocks())

it('keeps what the item stored, and labels an item with nothing stored', async () => {
  mockBatchResolveMedia.mockResolvedValue(
    new Map([
      [1, missingFromTmdbMedia(1, 'tv')],
      [2, missingFromTmdbMedia(2, 'tv')],
    ])
  )

  const cards = await getMinimalCardDataForPlaylist([
    item(1, { title: 'Severance', posterURL: 'https://image.tmdb.org/t/p/w500/sev.jpg' }),
    item(2),
  ])

  expect(cards.find((card) => card.tmdbId === 1)).toMatchObject({
    title: 'Severance',
    posterURL: 'https://image.tmdb.org/t/p/w500/sev.jpg',
    isAvailable: false,
  })
  expect(cards.find((card) => card.tmdbId === 2)).toMatchObject({
    title: 'No longer on TMDB',
    posterURL: '/sorry-image-not-available.jpg',
    isAvailable: false,
  })
})

it('still says "Unknown Title" when the lookup failed for another reason', async () => {
  mockBatchResolveMedia.mockResolvedValue(new Map())

  const [card] = await getMinimalCardDataForPlaylist([item(3)])
  expect(card.title).toBe('Unknown Title')
})
