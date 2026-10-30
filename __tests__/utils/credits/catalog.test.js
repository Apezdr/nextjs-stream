/**
 * @jest-environment node
 *
 * The credits catalog behind the "Credits & licenses" menu item and page
 * (CREDITS_SIDECAR.md, sections 7 and 8), over an in-memory Media database: the
 * library's credits, and the titles a user may see that have credits to show.
 */

const { createMemoryMongo } = require('../../helpers/memoryMongo')

const mockMongo = createMemoryMongo()
let mockServers = [{ id: 'A', priority: 1 }]
jest.mock('@src/lib/mongodb', () => ({ __esModule: true, default: Promise.resolve(mockMongo.client) }))
jest.mock('@src/utils/config', () => ({ getAllServers: () => mockServers }))

const { getCreditsCatalog, getCreditsAvailability, clearCreditsCatalogCache } = require('@src/utils/credits/catalog')
const fixtures = require('../../helpers/creditsFixtures')

const col = (name) => mockMongo.collection('Media', name)
const PLAYABLE = { videoURL: 'https://A/v.mp4', primaryContainer: 'mp4' }
const library = () => ({
  schemaVersion: 1,
  assets: [{ id: 'collage', kind: 'artwork', path: 'poster_collage.jpg' }],
  entries: [{ id: 'collage-1', assetIds: ['collage'], work: 'A poster', license: 'CC BY 3.0' }],
})
const FULL = { includeTitles: true }
const LIMITED = { includeTitles: false }

beforeEach(() => {
  for (const name of ['FlatMovies', 'FlatTVShows', 'FlatEpisodes', 'LibraryCredits']) col(name).docs.length = 0
  mockServers = [{ id: 'A', priority: 1 }]
  clearCreditsCatalogCache()
})

it('has nothing, and no menu item, when nothing has credits', async () => {
  col('FlatMovies').docs.push({ _id: 'm1', title: 'Plain', originalTitle: 'Plain', ...PLAYABLE })
  expect(await getCreditsCatalog(FULL)).toEqual({ library: null, titles: [] })
  expect(await getCreditsAvailability(FULL)).toEqual({ available: false, library: false, titles: 0 })
})

it('lists credited titles, not their credits, and no library section without a library file', async () => {
  col('FlatMovies').docs.push(
    { _id: 'm1', title: 'Zed', originalTitle: 'Zed (2020)', credits: fixtures.mixedGrants(), ...PLAYABLE },
    { _id: 'm2', title: 'Alpha', originalTitle: 'Alpha (2019)', credits: fixtures.exactBackdropSource(), ...PLAYABLE }
  )
  const catalog = await getCreditsCatalog(FULL)
  expect(catalog).toEqual({
    library: null,
    titles: [
      { type: 'movie', id: 'm2', title: 'Alpha', originalTitle: 'Alpha (2019)' },
      { type: 'movie', id: 'm1', title: 'Zed', originalTitle: 'Zed (2020)' },
    ],
  })
  expect(await getCreditsAvailability(FULL)).toEqual({ available: true, library: false, titles: 2 })
})

it('names the credited episodes of a show, and lists a show whose only credits are an episode\'s', async () => {
  col('FlatTVShows').docs.push(
    { _id: 's1', title: 'Series', originalTitle: 'Series', credits: fixtures.seriesShow(), visibleEpisodeCount: 3 },
    { _id: 's2', title: 'Other', originalTitle: 'Other', visibleEpisodeCount: 2 }
  )
  col('FlatEpisodes').docs.push(
    { _id: 'e1', showId: 's1', seasonNumber: 1, episodeNumber: 2, title: 'Two', credits: fixtures.episodeOwn(2, 'Two'), ...PLAYABLE },
    { _id: 'e2', showId: 's1', seasonNumber: 1, episodeNumber: 1, title: 'One', ...PLAYABLE },
    { _id: 'e3', showId: 's2', seasonNumber: 1, episodeNumber: 1, title: 'Only', credits: fixtures.episodeOwn(1, 'Only'), ...PLAYABLE },
    // Suppresses inherited entries and adds none: nothing of its own to show
    { _id: 'e4', showId: 's1', seasonNumber: 1, episodeNumber: 3, title: 'Three', credits: { schemaVersion: 1, assets: [], entries: [], suppress: ['x'] }, ...PLAYABLE }
  )
  expect((await getCreditsCatalog(FULL)).titles).toEqual([
    { type: 'tv', id: 's2', title: 'Other', originalTitle: 'Other', hasCredits: false, episodes: [{ seasonNumber: 1, episodeNumber: 1, title: 'Only' }] },
    { type: 'tv', id: 's1', title: 'Series', originalTitle: 'Series', hasCredits: true, episodes: [{ seasonNumber: 1, episodeNumber: 2, title: 'Two' }] },
  ])
})

it('leaves out titles the lists hide, and credits that are not valid to show', async () => {
  col('FlatMovies').docs.push(
    { _id: 'm1', title: 'Hidden', originalTitle: 'Hidden', credits: fixtures.mixedGrants(), videoURL: 'https://A/v.avi', primaryContainer: 'avi' },
    { _id: 'm2', title: 'Broken', originalTitle: 'Broken', credits: { schemaVersion: 1, assets: [], entries: [{ id: 'x', assetIds: ['nope'], work: 'W' }] }, ...PLAYABLE }
  )
  col('FlatTVShows').docs.push({ _id: 's1', title: 'Gone', originalTitle: 'Gone', credits: fixtures.seriesShow(), visibleEpisodeCount: 0 })
  col('FlatEpisodes').docs.push({ _id: 'e1', showId: 's1', seasonNumber: 1, episodeNumber: 1, credits: fixtures.episodeOwn(1, 'E'), ...PLAYABLE })
  expect(await getCreditsCatalog(FULL)).toEqual({ library: null, titles: [] })
})

it('counts last valid credits kept through a failed sync', async () => {
  col('FlatMovies').docs.push({
    _id: 'm1', title: 'Kept', originalTitle: 'Kept', ...PLAYABLE,
    credits: fixtures.mixedGrants(), creditsStatus: { state: 'error', reason: 'fetch-failed', serverId: 'A' },
  })
  expect(await getCreditsAvailability(FULL)).toEqual({ available: true, library: false, titles: 1 })
})

it('shows only the library to a user with limited access, with no count of titles', async () => {
  col('FlatMovies').docs.push({ _id: 'm1', title: 'T', originalTitle: 'T', credits: fixtures.mixedGrants(), ...PLAYABLE })
  expect(await getCreditsAvailability(LIMITED)).toEqual({ available: false, library: false, titles: 0 })

  col('LibraryCredits').docs.push({ _id: 'A', credits: library(), creditsHash: 'h' })
  clearCreditsCatalogCache()
  const catalog = await getCreditsCatalog(LIMITED)
  expect(catalog.titles).toEqual([])
  expect(catalog.library.entries.map((entry) => entry.id)).toEqual(['collage-1'])
  expect(await getCreditsAvailability(LIMITED)).toEqual({ available: true, library: true, titles: 0 })
})

it('takes the library of enabled servers only, in priority order', async () => {
  mockServers = [{ id: 'B', priority: 2 }, { id: 'A', priority: 1 }, { id: 'C', priority: 0, enabled: false }]
  const second = { ...library(), entries: [{ id: 'second', assetIds: ['collage'], work: 'B art' }] }
  const disabled = { ...library(), entries: [{ id: 'disabled', assetIds: ['collage'], work: 'C art' }] }
  col('LibraryCredits').docs.push(
    { _id: 'B', credits: second, creditsHash: 'hb' },
    { _id: 'A', credits: library(), creditsHash: 'ha' },
    { _id: 'C', credits: disabled, creditsHash: 'hc' },
    // A failure with nothing valid kept yet: not shown, not counted
    { _id: 'D', creditsStatus: { state: 'error', reason: 'schema' } }
  )
  expect((await getCreditsCatalog(FULL)).library.entries.map((entry) => entry.id)).toEqual(['collage-1', 'second'])
})

it('reuses a catalog for a short while, and never keeps a failed read', async () => {
  const first = await getCreditsCatalog(FULL)
  col('FlatMovies').docs.push({ _id: 'm1', title: 'New', originalTitle: 'New', credits: fixtures.mixedGrants(), ...PLAYABLE })
  expect(await getCreditsCatalog(FULL)).toBe(first)
  clearCreditsCatalogCache()
  expect((await getCreditsCatalog(FULL)).titles).toHaveLength(1)

  clearCreditsCatalogCache()
  const movies = col('FlatMovies')
  const find = movies.find
  movies.find = () => ({ toArray: async () => { throw new Error('connection reset') } })
  await expect(getCreditsAvailability(FULL)).rejects.toThrow('connection reset')
  movies.find = find
  expect(await getCreditsAvailability(FULL)).toEqual({ available: true, library: false, titles: 1 })
})
