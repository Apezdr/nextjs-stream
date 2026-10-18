/**
 * @jest-environment node
 *
 * A movie's chapter file belongs to the highest-priority server among those
 * that report `urls.chapters` (core/ownership), ties broken on server id. It
 * used to be ranked with the fail-open check, which answers "yes" when the
 * availability map has no entry for the title or the field, and for every
 * server of the best priority. The two agree for every payload a processor
 * publishes today: `urls.chapters` is in the map exactly when the server has
 * a chapter file, and server priorities are distinct. These are the inputs
 * where they do not.
 */

const mockServers = {
  A: { id: 'A', priority: 1 },
  B: { id: 'B', priority: 1 }, // the same priority as A
  C: { id: 'C', priority: 2 },
}

jest.mock('@src/utils/sync/core/ResourceManager', () => ({
  ResourceManager: { getInstance: () => ({ throttleHttp: (fn) => fn() }) },
  getResourceManager: () => ({}),
}))
jest.mock('@src/lib/httpHelper', () => ({ httpGet: jest.fn() }))
jest.mock('@src/lib/mongodb', () => ({ __esModule: true, default: Promise.resolve({}) }))
jest.mock('@src/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  logError: jest.fn(),
}))
jest.mock('@src/utils/config', () => ({
  getServer: (id) => {
    if (!mockServers[id]) throw new Error(`No server found with ID: ${id}`)
    return mockServers[id]
  },
  multiServerHandler: {},
}))

const { MovieContentStrategy } = require('@src/utils/sync/domain/movies/strategies/MovieContentStrategy')
const { MediaType, SyncOperation } = require('@src/utils/sync/core')
const { collectFieldAvailability } = require('@src/utils/sync/run/availability')

const KEY = 'Film (2020)'
const FOLDER = `/movies/${encodeURIComponent(KEY)}`
const CHAPTERS = `${FOLDER}/chapters/Film_chapters.vtt`

/** A folder with a video and a chapter file, as a processor publishes it. */
const moviePayload = () => ({
  fileNames: ['Film.mkv'],
  urls: { mp4: `${FOLDER}/Film.mkv`, chapters: CHAPTERS },
  additional_metadata: { duration: 6000000 },
})

/** A map built from the payloads, as the sync route builds it. */
const availabilityOf = (payloads) => {
  const fieldAvailability = { movies: { [KEY]: {} }, tv: {} }
  for (const [id, payload] of Object.entries(payloads)) {
    collectFieldAvailability(payload, '', id, fieldAvailability.movies[KEY])
  }
  return fieldAvailability
}

/**
 * One server's content pass over `stored`. Returns the document's chapter
 * fields after it, and whether the pass wrote the chapter URL.
 */
async function contentPass(serverId, payload, fieldAvailability, stored = {}) {
  const pendingMovieUpdates = new Map([[KEY, {}]])
  const result = await new MovieContentStrategy({ findByOriginalTitle: jest.fn() }).sync(
    { title: 'Film', originalTitle: KEY, ...stored },
    {
      mediaType: MediaType.Movie,
      operation: SyncOperation.Content,
      serverConfig: { ...mockServers[serverId], baseUrl: `https://${serverId}.example`, prefix: '', enabled: true },
      fieldAvailability,
      fileServerData: { movies: { [KEY]: payload } },
      entityTitle: 'Film',
      entityOriginalTitle: KEY,
      allEnabledServersProbed: true,
      pendingMovieUpdates,
      pendingMovieUnsets: new Map([[KEY, new Set()]]),
      pendingMovieDeferrals: new Set(),
      pendingMovieFetchFailures: new Map([[KEY, new Set()]]),
    }
  )
  const document = { ...stored, ...pendingMovieUpdates.get(KEY) }
  return {
    wrote: result.changes.includes('Updated chapterURL'),
    chapters: { chapterURL: document.chapterURL, chapterSource: document.chapterSource },
  }
}

/** The servers' passes in order, each over the document the last one left. */
async function run(payloads, order, fieldAvailability = availabilityOf(payloads)) {
  let chapters = {}
  for (const serverId of order) {
    chapters = (await contentPass(serverId, payloads[serverId], fieldAvailability, chapters)).chapters
  }
  return chapters
}

const chaptersOf = (serverId) => ({ chapterURL: `https://${serverId}.example${CHAPTERS}`, chapterSource: serverId })
const withoutChapters = () => ({ ...moviePayload(), urls: { mp4: `${FOLDER}/Film.mkv` } })

beforeAll(() => {
  for (const method of ['log', 'warn', 'info', 'debug', 'error']) {
    jest.spyOn(console, method).mockImplementation(() => {})
  }
})

describe('two servers configured with the same priority, both with chapters', () => {
  const payloads = { A: moviePayload(), B: moviePayload() }

  it.each([[['A', 'B']], [['B', 'A']]])('take them from the lower id, synced in order %j', async (order) => {
    // Fail-open let both through, and the movie held whichever synced last.
    expect(await run(payloads, order)).toEqual(chaptersOf('A'))
  })
})

describe('chapters the availability map does not list for the server', () => {
  it('are not written when the map has nothing for the title', async () => {
    // Fail-open answered yes for a title missing from the map.
    const pass = await contentPass('A', moviePayload(), { movies: {}, tv: {} })

    expect(pass.wrote).toBe(false)
    expect(pass.chapters).toEqual({ chapterURL: undefined, chapterSource: undefined })
  })

  it('do not replace another server\'s when the map does not list them', async () => {
    const mapWithoutChapters = availabilityOf({ A: withoutChapters() })
    const pass = await contentPass('A', moviePayload(), mapWithoutChapters, chaptersOf('C'))

    expect(pass.wrote).toBe(false)
    expect(pass.chapters).toEqual(chaptersOf('C'))
  })
})

describe('what the two checks agree on', () => {
  it.each([[['A', 'C']], [['C', 'A']]])('the chapters come from the server that has them when a higher-priority one does not, synced in order %j', async (order) => {
    expect(await run({ A: withoutChapters(), C: moviePayload() }, order)).toEqual(chaptersOf('C'))
  })

  it.each([[['A', 'C']], [['C', 'A']]])('a lower-priority server does not replace the owner\'s, synced in order %j', async (order) => {
    expect(await run({ A: moviePayload(), C: moviePayload() }, order)).toEqual(chaptersOf('A'))
  })
})
