/**
 * @jest-environment node
 *
 * A movie's caption language belongs to the highest-priority server among
 * those the availability map lists for `urls.subtitles.<language>.url`
 * (core/ownership). A server the map does not list for it never owns it, even
 * when its own payload lists the language. The check used to count the
 * syncing server as a reporter whenever its payload listed one.
 */

const mockServers = { A: { id: 'A', priority: 1 }, B: { id: 'B', priority: 2 } }

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

const { syncMovieVideo } = require('@src/utils/sync/domain/movies/video')
const { collectFieldAvailability } = require('@src/utils/sync/run/availability')

const KEY = 'Film (2020)'
const FOLDER = `/movies/${encodeURIComponent(KEY)}`
const SUBTITLE = `${FOLDER}/Film.en.srt`

/** A folder with a video and an English subtitle, as a processor publishes it. */
const withCaptions = () => ({
  fileNames: ['Film.mkv'],
  urls: { mp4: `${FOLDER}/Film.mkv`, subtitles: { English: { url: SUBTITLE, srcLang: 'en', lastModified: 'm1' } } },
  additional_metadata: { duration: 6000000 },
})
const withoutCaptions = () => ({ ...withCaptions(), urls: { mp4: `${FOLDER}/Film.mkv` } })

/** A map built from the payloads, as the sync route builds it. */
const availabilityOf = (payloads) => {
  const fieldAvailability = { movies: { [KEY]: {} }, tv: {} }
  for (const [id, payload] of Object.entries(payloads)) {
    collectFieldAvailability(payload, '', id, fieldAvailability.movies[KEY])
  }
  return fieldAvailability
}

/** One server's video step over `stored`; returns the captions it leaves. */
async function captionsAfter(serverId, payload, fieldAvailability, stored = {}) {
  const { plan } = await syncMovieVideo({
    originalTitle: KEY,
    movie: { title: 'Film', originalTitle: KEY, ...stored },
    payload,
    run: {
      serverConfig: { ...mockServers[serverId], baseUrl: `https://${serverId}.example`, prefix: '', enabled: true },
      forceSync: false,
      allEnabledServersProbed: true,
    },
    availability: { fieldAvailability },
  })
  return { ...stored, ...plan.set }.captionURLs
}

const english = (serverId) => ({
  English: { srcLang: 'en', url: `https://${serverId}.example${SUBTITLE}`, lastModified: 'm1', sourceServerId: serverId },
})

beforeAll(() => {
  for (const method of ['log', 'warn', 'info', 'debug', 'error']) {
    jest.spyOn(console, method).mockImplementation(() => {})
  }
})

describe('a caption language the availability map does not list for the server', () => {
  it('is not written', async () => {
    const map = availabilityOf({ A: withoutCaptions() })
    expect(await captionsAfter('A', withCaptions(), map)).toBeUndefined()
  })

  it('does not replace another server\'s entry', async () => {
    const map = availabilityOf({ A: withoutCaptions(), B: withCaptions() })
    expect(await captionsAfter('A', withCaptions(), map, { captionURLs: english('B') })).toEqual(english('B'))
  })
})

describe('a caption language the map lists for the server', () => {
  it('is written by the highest-priority server listing it', async () => {
    const map = availabilityOf({ A: withCaptions(), B: withCaptions() })
    expect(await captionsAfter('A', withCaptions(), map, { captionURLs: english('B') })).toEqual(english('A'))
    expect(await captionsAfter('B', withCaptions(), map, { captionURLs: english('A') })).toEqual(english('A'))
  })
})
