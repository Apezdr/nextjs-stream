/**
 * @jest-environment node
 *
 * /api/authenticated/media sends `credits` resolved for display
 * (CREDITS_SIDECAR.md, section 6): on the TV-device shape (an explicit
 * allowlist, sanitizeTVData) and the flat GET alike, for shows and episodes.
 * getFlatRequestedMedia resolves them (withDisplayCredits) and leaves the
 * sync's bookkeeping out.
 */

jest.mock('@src/utils/routeAuth', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ id: 'user-1' })),
  isAuthenticatedAndApproved: jest.fn(async () => ({ id: 'user-1' })),
}))
jest.mock('@src/utils/jit/preference', () => ({ applyJitPreference: jest.fn(async () => {}) }))
jest.mock('@src/utils/watchHistoryUtils', () => ({ addWatchHistoryToItems: jest.fn(async (items) => items) }))
jest.mock('@src/lib/mongodb', () => ({ __esModule: true, default: Promise.resolve({}) }))

const { resolveEpisodeCredits, resolveTitleCredits } = require('@src/utils/credits/resolve')
const fixtures = require('../helpers/creditsFixtures')

const showCredits = resolveTitleCredits(fixtures.seriesShow())
const episodeCredits = resolveEpisodeCredits(fixtures.seriesShow(), fixtures.episodeOwn(1, 'Ep'))

const show = () => ({
  _id: 'show-1',
  id: 'show-1',
  title: 'A Show',
  originalTitle: 'A Show',
  type: 'tv',
  seasons: [{ seasonNumber: 1 }],
  metadata: { overview: 'The synopsis, and only the synopsis.' },
  credits: showCredits,
})
const episode = () => ({ ...show(), seasonNumber: 1, episodeNumber: 1, videoURL: 'https://files.example/e1.mp4', credits: episodeCredits })

const mockGetFlatRequestedMedia = jest.fn()
jest.mock('@src/utils/flatDatabaseUtils', () => ({
  getFlatRequestedMedia: (...args) => mockGetFlatRequestedMedia(...args),
  getFlatTVSeasonWithEpisodes: jest.fn(async () => null),
  getVisibleEpisodeCountBySeason: jest.fn(async () => new Map([[1, 10]])),
}))

const { GET } = require('@src/app/api/authenticated/media/route')
const { withDisplayCredits } = jest.requireActual('@src/utils/flatDatabaseUtils')

const get = async (query) => (await GET(new Request(`https://cinema.example/api/authenticated/media?${query}`))).json()

beforeEach(() => {
  jest.clearAllMocks()
  mockGetFlatRequestedMedia.mockImplementation(async (request) => (request.episode ? episode() : show()))
})

it('carries a show\'s credits on the TV-device response', async () => {
  const body = await get('mediaType=tv&mediaId=show-1&isTVdevice=true')
  expect(body.credits).toEqual(showCredits)
  expect(body.metadata.overview).toBe('The synopsis, and only the synopsis.')
})

it('carries an episode\'s resolved credits on the TV-device response', async () => {
  const body = await get('mediaType=tv&mediaId=show-1&season=1&episode=1&isTVdevice=true')
  expect(body.credits.entries.map((entry) => `${entry.scope}:${entry.id}`)).toEqual([
    'show:series-art-credit',
    'show:collage-poster-1',
    'show:collage-poster-2',
    'show:collage-poster-3',
    'episode:episode-credit',
    'episode:subtitles-credit',
    'episode:score-credit',
  ])
})

it('carries them on the flat GET response', async () => {
  expect((await get('mediaType=tv&mediaId=show-1')).credits).toEqual(showCredits)
})

it('sends no credits key when there are none', async () => {
  mockGetFlatRequestedMedia.mockImplementation(async () => ({ ...show(), credits: undefined }))
  expect(await get('mediaType=tv&mediaId=show-1&isTVdevice=true')).not.toHaveProperty('credits')
})

describe('withDisplayCredits', () => {
  it('puts the resolved credits in place of the stored file and leaves the bookkeeping out', () => {
    const doc = {
      title: 'Film',
      credits: fixtures.mixedGrants(),
      creditsSource: 'A',
      creditsHash: 'h',
      creditsStatus: { state: 'error', reason: 'fetch-failed' },
    }
    const result = withDisplayCredits(doc, resolveTitleCredits(doc.credits))
    expect(result).toEqual({ title: 'Film', credits: resolveTitleCredits(fixtures.mixedGrants()) })
  })

  it('removes `credits` when there is nothing to show', () => {
    expect(withDisplayCredits({ title: 'Film', credits: { broken: true } }, null)).toEqual({ title: 'Film' })
  })
})
