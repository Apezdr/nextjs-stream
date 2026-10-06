/**
 * @jest-environment node
 *
 * The movie sync has to end in the same document whatever order the file
 * servers are synced in, however many times the run repeats, and whether or
 * not the run is forced. These cases drive the real MovieSyncService, its three
 * strategies and MovieRepository against an in-memory collection, with the
 * payloads a media processor actually publishes.
 *
 * Each one is a state the old sync got wrong:
 *
 *  - a folder with no video on the higher-priority server wiped the video the
 *    other server supplies, on every run;
 *  - a deleted or replaced file left its duration, size, HDR label and video
 *    id on the document;
 *  - two servers with different subtitle languages overwrote each other, and a
 *    removed subtitle stayed once it was the last one;
 *  - the display title flipped between the TMDB title and the folder name.
 *
 * The later describe blocks are the cases a review of the first fix turned up:
 * a file the server could not probe, a run with a server missing, metadata on
 * one server only, and the skip gate's own bookkeeping.
 */

const mockServers = { A: { id: 'A', priority: 1 }, B: { id: 'B', priority: 2 }, C: { id: 'C', priority: 3 } }
// Full URLs of files a file server publishes but cannot serve right now.
const mockFailingUrls = new Set()
// What a blurhash file holds: it names the server it was read from and the
// version of the image it is of, so a case can tell a stale one from a fresh one.
let mockImageVersion = 'v1'
const mockBlurhashOf = (url) => `blurhash-of:${url}#${mockImageVersion}`
let mockMetadata = { id: 603, title: 'The Matrix', overview: 'x' }
// Set to give one server a metadata file of its own.
let mockMetadataByServer = {}

jest.mock('@src/utils/sync/core/ResourceManager', () => ({
  ResourceManager: class {},
  getResourceManager: () => ({}),
}))
jest.mock('@src/utils/sync/captions', () => ({ sortSubtitleEntries: (entries) => entries }))
jest.mock('@src/lib/httpHelper', () => ({
  // The asset strategy reads a blurhash file with this.
  httpGet: jest.fn(async (url) => {
    if (mockFailingUrls.has(url)) throw new Error(`timeout of 3000ms exceeded: ${url}`)
    return { data: mockBlurhashOf(url), headers: { 'content-type': 'text/plain' } }
  }),
}))
jest.mock('@src/lib/mongodb', () => ({ __esModule: true, default: Promise.resolve({}) }))
jest.mock('@src/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  logError: jest.fn(),
}))
jest.mock('@src/utils/config', () => ({
  getServer: (id) => mockServers[id],
  multiServerHandler: {},
}))
jest.mock('@src/utils/admin_utils', () => ({
  // Like the real one: a server with no metadata file for the title is not
  // asked at all, and the answer is an empty object.
  fetchMetadataMultiServer: jest.fn(async (serverId, url, type) => {
    if (!url) return {}
    if (type === 'blurhash') {
      // The blurhash strategy's second attempt at a blurhash still missing.
      if (mockFailingUrls.has(`https://${serverId}.example${url}`)) throw new Error(`fetch failed: ${url}`)
      return mockBlurhashOf(`https://${serverId}.example${url}`)
    }
    const metadata = mockMetadataByServer[serverId] ?? mockMetadata
    return metadata ? { ...metadata } : null
  }),
}))

const { MovieSyncService } = require('@src/utils/sync/domain/movies/MovieSyncService')
const { MovieMetadataStrategy } = require('@src/utils/sync/domain/movies/strategies/MovieMetadataStrategy')
const { MovieAssetStrategy } = require('@src/utils/sync/domain/movies/strategies/MovieAssetStrategy')
const { MovieContentStrategy } = require('@src/utils/sync/domain/movies/strategies/MovieContentStrategy')
const { BlurhashStrategy } = require('@src/utils/sync/domain/shared/BlurhashStrategy')
const { MovieRepository } = require('@src/utils/sync/infrastructure/database/MovieRepository')
const { resolveCleanupConfig } = require('@src/utils/sync/core/FieldAbsenceCleaner')
const { SyncOperation, MediaType } = require('@src/utils/sync/core')
// The availability map is built by the same function the admin sync route uses.
const { collectFieldAvailability } = require('@src/utils/sync/fieldAvailability')

// ---------------------------------------------------------------- in-memory collection

// The document's own date fields come back from MongoDB as Dates. A caption's
// lastModified is a string the file server sent and stays one.
const DATE_FIELDS = ['createdAt', 'updatedAt', 'lastSynced', 'initialDiscoveryDate', 'mediaLastModified']
function reviveDates(doc) {
  for (const field of DATE_FIELDS) {
    if (typeof doc[field] === 'string') doc[field] = new Date(doc[field])
  }
  return doc
}

// MongoDB stores a field that is set to `undefined` as `null`; a plain JSON
// round trip would drop it instead, and hide every comparison that tells the
// two apart.
const stored = (value) => JSON.parse(JSON.stringify(value, (_key, v) => (v === undefined ? null : v)))

function makeCollection(docs) {
  const match = (doc, filter) => Object.entries(filter).every(([k, v]) => doc[k] === v)
  return {
    async findOne(filter) {
      const doc = docs.find((d) => match(d, filter))
      return doc ? reviveDates(JSON.parse(JSON.stringify(doc))) : null
    },
    async updateOne(filter, update, options = {}) {
      let doc = docs.find((d) => match(d, filter))
      if (!doc) {
        if (!options.upsert) return { matchedCount: 0 }
        doc = { ...filter, ...stored(update.$setOnInsert || {}) }
        docs.push(doc)
      }
      const setKeys = Object.keys(update.$set || {})
      const unsetKeys = Object.keys(update.$unset || {})
      // MongoDB rejects an update that sets and unsets the same path.
      const conflict = setKeys.filter((k) => unsetKeys.includes(k))
      if (conflict.length > 0) throw new Error(`conflicting $set/$unset on ${conflict.join(', ')}`)
      Object.assign(doc, stored(update.$set || {}))
      for (const key of unsetKeys) delete doc[key]
      return { matchedCount: 1 }
    },
    async replaceOne(filter, replacement, options = {}) {
      const index = docs.findIndex((d) => match(d, filter))
      if (index >= 0) docs[index] = { _id: docs[index]._id, ...stored(replacement) }
      else if (options.upsert) docs.push(stored(replacement))
      return {}
    },
  }
}

// ---------------------------------------------------------------- payloads

const KEY = 'The Matrix (1999)'
const FOLDER = `/movies/${encodeURIComponent(KEY)}`

const HDR_QUALITY = {
  format: 'HDR10', bitDepth: 10, colorSpace: 'YUV', transferCharacteristics: 'PQ', isHDR: true,
  viewingExperience: { enhancedColor: true, highDynamicRange: true, dolbyVision: false, hdr10Plus: false, standardHDR: true },
}
const SDR_QUALITY = {
  format: '8-bit SDR (BT.709)', bitDepth: 8, colorSpace: 'YUV', transferCharacteristics: 'BT.709', isHDR: false,
  viewingExperience: { enhancedColor: false, highDynamicRange: false, dolbyVision: false, hdr10Plus: false, standardHDR: false },
}

/** A folder with a video. `file` names it, so two servers can hold different files. */
const withVideo = ({ file = 'The Matrix.mkv', subtitles, ...over } = {}) => ({
  _id: 'uuid-1',
  mediaIdentity: { id: 'mid:abc', scheme: 'mid', firstSeen: '2024-01-01T00:00:00.000Z' },
  fileNames: [file, 'metadata.json'],
  length: { [file]: 8160000 },
  dimensions: { [file]: '3840x2160' },
  urls: {
    mp4: `${FOLDER}/${encodeURIComponent(file)}`,
    mediaLastModified: '2024-01-01T00:00:00.000Z',
    sources: [{ url: `${FOLDER}/${encodeURIComponent(file)}`, filename: file, container: 'mkv', isPrimary: true, size: 5 }],
    jitEligible: true,
    jitUrl: `https://jit.example/stream/${encodeURIComponent(file)}/master.m3u8`,
    metadata: `${FOLDER}/metadata.json?hash=d1`,
    poster: `${FOLDER}/poster.jpg?hash=p1`,
    posterBlurhash: `${FOLDER}/poster.jpg.blurhash`,
    ...(subtitles === null
      ? {}
      : { subtitles: subtitles ?? { English: { url: `${FOLDER}/The%20Matrix.en.srt`, srcLang: 'en', lastModified: '2024-01-01T00:00:00.000Z' } } }),
    chapters: `${FOLDER}/chapters/x_chapters.vtt`,
  },
  hdr: 'HDR10',
  mediaQuality: HDR_QUALITY,
  additional_metadata: { duration: 8160000, dimensions: '3840x2160', size: { kb: 1, mb: 1, gb: 50 } },
  backdropFocal: null,
  backdropFocalSuggested: null,
  ...over,
})

/** What a processor publishes for a folder that has artwork and metadata but no video. */
const withoutVideo = () => ({
  _id: 'tmdb_603',
  mediaIdentity: { id: 'mid:abc', scheme: 'mid', firstSeen: '2024-01-01T00:00:00.000Z' },
  fileNames: ['metadata.json'],
  length: {},
  dimensions: {},
  urls: {
    metadata: `${FOLDER}/metadata.json?hash=d2`,
    poster: `${FOLDER}/poster.jpg?hash=p1`,
  },
  hdr: null,
  mediaQuality: null,
  additional_metadata: {},
  backdropFocal: null,
  backdropFocalSuggested: null,
})

// ---------------------------------------------------------------- driving a run

function makeService(docs) {
  const client = { db: () => ({ collection: () => makeCollection(docs) }) }
  const repo = new MovieRepository(client)
  const fileAdapter = {
    validateAvailability: async () => ({ available: [] }),
    getMetadata: async () => ({ exists: false }),
  }
  return new MovieSyncService(repo, fileAdapter, [
    new MovieMetadataStrategy(repo, fileAdapter),
    new MovieAssetStrategy(repo, fileAdapter),
    new MovieContentStrategy(repo, fileAdapter),
    new BlurhashStrategy(repo),
  ])
}

/** One server's pass. `payloads` is every server that answered this run. */
async function pass(docs, serverId, payloads, { forceSync = false, allProbed = true, hashesOf = payloads, hashes = true } = {}) {
  const fieldAvailability = { movies: { [KEY]: {} }, tv: {} }
  for (const [id, payload] of Object.entries(payloads)) {
    collectFieldAvailability(payload, '', id, fieldAvailability.movies[KEY])
  }
  const context = {
    mediaType: MediaType.Movie,
    operation: SyncOperation.Metadata,
    serverConfig: { id: serverId, priority: mockServers[serverId].priority, baseUrl: `https://${serverId}.example`, prefix: '', enabled: true },
    fieldAvailability,
    forceSync,
    fileServerData: { movies: { [KEY]: payloads[serverId] } },
    // The file server's hash for the title: a hash of its payload. The skip
    // decision does not read it (only the metadata strategy's own refetch gate
    // does). `hashesOf` lets a case hand over the hash of a DIFFERENT payload
    // than the one applied — what happens when a scan commits between the two
    // fetches. `hashes: false` is a run on which the hash request failed.
    metadataHashesCache: hashes
      ? { hash: 'x', titles: { [KEY]: { hash: `h:${JSON.stringify(hashesOf[serverId]).length}:${JSON.stringify(hashesOf[serverId])}` } } }
      : undefined,
    cleanup: resolveCleanupConfig(allProbed),
    allEnabledServersProbed: allProbed,
  }
  return makeService(docs).syncMovie(
    KEY,
    context,
    // The four operations production runs (flatSync/newArchitectureAdapter).
    [SyncOperation.Metadata, SyncOperation.Assets, SyncOperation.Content, SyncOperation.Blurhash],
    KEY
  )
}

/** A whole run: every server that has the folder is synced, in the given order. */
async function run(docs, payloads, order, options) {
  for (const serverId of order) {
    if (payloads[serverId]) await pass(docs, serverId, payloads, options)
  }
}

// The document without what legitimately differs between runs or orders: the
// write timestamps, the sync's own bookkeeping (the last writer's hash, and
// which servers' gates are currently stamped), and which server happened to
// create the document (originalTitleSource is that and nothing more; the folder
// name is the same on every server).
const VOLATILE = ['lastSynced', 'updatedAt', 'createdAt', 'syncHash', 'syncGates', 'metadataHash', 'syncRunId', 'originalTitleSource']
function settled(doc) {
  const copy = JSON.parse(JSON.stringify(doc))
  for (const key of VOLATILE) delete copy[key]
  return copy
}

const A_URL = `https://A.example${FOLDER}/The%20Matrix.mkv`
const B_URL = `https://B.example${FOLDER}/The%20Matrix.mkv`
const FILE_FACTS = ['normalizedVideoId', 'duration', 'dimensions', 'size', 'hdr', 'mediaQuality', 'mediaLastModified']

beforeAll(() => {
  for (const method of ['log', 'warn', 'info', 'debug', 'error']) {
    jest.spyOn(console, method).mockImplementation(() => {})
  }
})
beforeEach(() => {
  mockMetadata = { id: 603, title: 'The Matrix', overview: 'x' }
  mockMetadataByServer = {}
  mockFailingUrls.clear()
  mockImageVersion = 'v1'
})

// ---------------------------------------------------------------- one server

describe('one server', () => {
  it('stores the video, its facts and its captions when a movie is added', async () => {
    const docs = []
    await run(docs, { A: withVideo() }, ['A'])

    expect(docs[0]).toMatchObject({
      originalTitle: KEY,
      videoURL: A_URL,
      videoSource: 'A',
      mediaId: 'mid:abc',
      duration: 8160000,
      dimensions: '3840x2160',
      hdr: 'HDR10',
      primaryContainer: 'mkv',
      jitEligible: true,
    })
    expect(docs[0].normalizedVideoId).toEqual(expect.any(String))
    expect(Object.keys(docs[0].captionURLs)).toEqual(['English'])
  })

  it('clears the video and everything that described the file when the file is deleted and the folder kept', async () => {
    const docs = []
    await run(docs, { A: withVideo() }, ['A'])
    await run(docs, { A: withoutVideo() }, ['A'])

    const doc = docs[0]
    expect(doc.videoURL).toBeNull()
    expect(doc.jitUrl).toBeNull()
    expect(doc.sources).toBeNull()
    expect(doc.primaryContainer).toBeNull()
    for (const field of FILE_FACTS) expect(doc).not.toHaveProperty(field)
    expect(doc).not.toHaveProperty('videoSource')
    expect(doc).not.toHaveProperty('videoInfoSource')
    expect(doc).not.toHaveProperty('captionURLs')
    expect(doc).not.toHaveProperty('chapterURL')
    // The folder's identity, its artwork and its metadata stay: it is still a title.
    expect(doc.mediaId).toBe('mid:abc')
    expect(doc.posterURL).toMatch(/poster\.jpg/)
    expect(doc.metadata.title).toBe('The Matrix')
  })

  it('reaches the same document through a forced sync', async () => {
    const batch = []
    await run(batch, { A: withVideo() }, ['A'])
    await run(batch, { A: withoutVideo() }, ['A'])

    const forced = []
    await run(forced, { A: withVideo() }, ['A'], { forceSync: true })
    await run(forced, { A: withoutVideo() }, ['A'], { forceSync: true })
    await run(forced, { A: withoutVideo() }, ['A'], { forceSync: true })

    expect(settled(forced[0])).toEqual(settled(batch[0]))
  })

  it('repairs a document left with a dead file\'s facts by an earlier version of the sync', async () => {
    const docs = []
    await run(docs, { A: withVideo() }, ['A'])
    // What the old sync left: URL cleared, the rest still there.
    Object.assign(docs[0], { videoURL: null, jitUrl: null, sources: null, primaryContainer: null, jitEligible: false })

    await run(docs, { A: withoutVideo() }, ['A'], { forceSync: true })

    for (const field of FILE_FACTS) expect(docs[0]).not.toHaveProperty(field)
    expect(docs[0]).not.toHaveProperty('videoSource')
  })

  it('takes every fact from the new file when the video comes back', async () => {
    const docs = []
    await run(docs, { A: withVideo() }, ['A'])
    const firstId = docs[0].normalizedVideoId
    await run(docs, { A: withoutVideo() }, ['A'])

    const replacement = withVideo({
      file: 'The Matrix 1080p.mkv',
      hdr: null,
      mediaQuality: SDR_QUALITY,
      additional_metadata: { duration: 8100000, dimensions: '1920x1080', size: { gb: 8 } },
    })
    await run(docs, { A: replacement }, ['A'])

    const doc = docs[0]
    expect(doc.videoURL).toBe(`https://A.example${FOLDER}/The%20Matrix%201080p.mkv`)
    expect(doc.videoSource).toBe('A')
    expect(doc.normalizedVideoId).toEqual(expect.any(String))
    expect(doc.normalizedVideoId).not.toBe(firstId)
    expect(doc.duration).toBe(8100000)
    expect(doc.dimensions).toBe('1920x1080')
    expect(doc.mediaQuality.isHDR).toBe(false)
    expect(doc).not.toHaveProperty('hdr')
    expect(doc.mediaId).toBe('mid:abc')
  })

  it('drops the HDR label when an HDR file is replaced by an SDR one under the same name', async () => {
    const docs = []
    await run(docs, { A: withVideo() }, ['A'])
    await run(docs, { A: withVideo({ hdr: null, mediaQuality: SDR_QUALITY }) }, ['A'])

    expect(docs[0]).not.toHaveProperty('hdr')
    expect(docs[0].mediaQuality.isHDR).toBe(false)
    expect(docs[0].videoURL).toBe(A_URL)
  })

  it('removes a subtitle that was deleted, including the last one', async () => {
    const two = {
      English: { url: `${FOLDER}/en.srt`, srcLang: 'en', lastModified: 'm1' },
      Spanish: { url: `${FOLDER}/es.srt`, srcLang: 'es', lastModified: 'm1' },
    }
    const docs = []
    await run(docs, { A: withVideo({ subtitles: two }) }, ['A'])
    expect(Object.keys(docs[0].captionURLs).sort()).toEqual(['English', 'Spanish'])

    await run(docs, { A: withVideo({ subtitles: { English: two.English } }) }, ['A'])
    expect(Object.keys(docs[0].captionURLs)).toEqual(['English'])

    await run(docs, { A: withVideo({ subtitles: null }) }, ['A'])
    expect(docs[0]).not.toHaveProperty('captionURLs')
    expect(docs[0]).not.toHaveProperty('captionSource')
  })

  it('writes nothing on a second, identical run', async () => {
    const docs = []
    await run(docs, { A: withVideo() }, ['A'])
    const before = JSON.stringify(docs[0])

    const results = await pass(docs, 'A', { A: withVideo() })
    const forcedResults = await pass(docs, 'A', { A: withVideo() }, { forceSync: true })

    expect(JSON.stringify(docs[0])).toBe(before)
    expect(results.every((r) => r.status === 'skipped')).toBe(true)
    expect(forcedResults.flatMap((r) => r.changes)).toEqual([])
  })

  it('never lets an admin-locked field be cleared', async () => {
    const docs = []
    await run(docs, { A: withVideo() }, ['A'])
    docs[0].lockedFields = { duration: true, captionURLs: true }

    await run(docs, { A: withoutVideo() }, ['A'])

    expect(docs[0].duration).toBe(8160000)
    expect(Object.keys(docs[0].captionURLs)).toEqual(['English'])
    expect(docs[0]).not.toHaveProperty('dimensions')
  })
})

// ---------------------------------------------------------------- the display title

describe('the display title', () => {
  it('is the TMDB title from the first sync on, whatever changes afterwards', async () => {
    const docs = []
    await run(docs, { A: withVideo() }, ['A'])
    expect(docs[0].title).toBe('The Matrix')

    // A change only the content strategy has something to write for.
    const withSpanish = withVideo({
      subtitles: {
        English: { url: `${FOLDER}/en.srt`, srcLang: 'en', lastModified: 'm1' },
        Spanish: { url: `${FOLDER}/es.srt`, srcLang: 'es', lastModified: 'm1' },
      },
    })
    await run(docs, { A: withSpanish }, ['A'])
    expect(docs[0].title).toBe('The Matrix')

    // A change only the asset strategy has something to write for.
    const newPoster = withVideo({ subtitles: withSpanish.urls.subtitles })
    newPoster.urls.poster = `${FOLDER}/poster.jpg?hash=p2`
    await run(docs, { A: newPoster }, ['A'])
    expect(docs[0].title).toBe('The Matrix')

    await run(docs, { A: newPoster }, ['A'], { forceSync: true })
    expect(docs[0].title).toBe('The Matrix')
  })

  it('is the folder name while the title has no metadata', async () => {
    mockMetadata = null
    const docs = []
    await run(docs, { A: withVideo() }, ['A'])
    expect(docs[0].title).toBe(KEY)
  })

  it('repairs a document an earlier version left with the folder name', async () => {
    const docs = []
    await run(docs, { A: withVideo() }, ['A'])
    docs[0].title = KEY

    await run(docs, { A: withVideo() }, ['A'], { forceSync: true })
    expect(docs[0].title).toBe('The Matrix')
  })

  it('leaves a title an admin locked', async () => {
    const docs = []
    await run(docs, { A: withVideo() }, ['A'])
    docs[0].title = 'The Matrix (Director\'s Cut)'
    docs[0].lockedFields = { title: true }

    await run(docs, { A: withVideo() }, ['A'], { forceSync: true })
    expect(docs[0].title).toBe('The Matrix (Director\'s Cut)')
  })
})

// ---------------------------------------------------------------- two servers

const ORDERS = [['A', 'B'], ['B', 'A']]

describe('two servers, the higher-priority one holding the folder without a video', () => {
  // The override-placeholder shape: artwork and metadata on the main server,
  // the video on the other.
  const payloads = { A: withoutVideo(), B: withVideo() }

  it.each(ORDERS)('keeps the other server\'s video, synced in order %s then %s', async (...order) => {
    const docs = []
    await run(docs, payloads, order)

    expect(docs[0].videoURL).toBe(B_URL)
    expect(docs[0].videoSource).toBe('B')
    expect(docs[0].primaryContainer).toBe('mkv')
    expect(docs[0].jitUrl).toMatch(/master\.m3u8$/)
    // The file's facts are the video owner's, not the placeholder's nulls.
    expect(docs[0].hdr).toBe('HDR10')
    expect(docs[0].mediaQuality.isHDR).toBe(true)
    expect(docs[0].duration).toBe(8160000)
    expect(docs[0].videoInfoSource).toBe('B')
  })

  it('never leaves the document without its video between the two passes', async () => {
    const docs = []
    await run(docs, payloads, ['B', 'A'])

    await pass(docs, 'B', payloads, { forceSync: true })
    expect(docs[0].videoURL).toBe(B_URL)
    await pass(docs, 'A', payloads, { forceSync: true })
    expect(docs[0].videoURL).toBe(B_URL)
  })

  it('ends in the same document in either order, and stays there on later runs', async () => {
    const [first, second] = [[], []]
    await run(first, payloads, ['A', 'B'])
    await run(second, payloads, ['B', 'A'])
    expect(settled(second[0])).toEqual(settled(first[0]))

    const before = settled(first[0])
    await run(first, payloads, ['B', 'A'])
    await run(first, payloads, ['A', 'B'], { forceSync: true })
    expect(settled(first[0])).toEqual(before)
  })
})

describe('two servers that both have the video', () => {
  const payloads = { A: withVideo(), B: withVideo({ hdr: null, mediaQuality: SDR_QUALITY }) }

  it.each(ORDERS)('takes the video and its facts from the higher-priority server, synced %s then %s', async (...order) => {
    const docs = []
    await run(docs, payloads, order)

    expect(docs[0].videoURL).toBe(A_URL)
    expect(docs[0].videoSource).toBe('A')
    expect(docs[0].hdr).toBe('HDR10')
    expect(docs[0].mediaQuality.isHDR).toBe(true)
  })

  it.each(ORDERS)('hands the video to the other server when the owner loses its file, synced %s then %s', async (...order) => {
    const docs = []
    await run(docs, payloads, order)

    const afterLoss = { A: withoutVideo(), B: payloads.B }
    await run(docs, afterLoss, order)

    expect(docs[0].videoURL).toBe(B_URL)
    expect(docs[0].videoSource).toBe('B')
    // B's file is SDR: the HDR label that described A's file must not survive.
    expect(docs[0]).not.toHaveProperty('hdr')
    expect(docs[0].mediaQuality.isHDR).toBe(false)
  })

  it('hands it over the same way when the owner\'s folder is gone entirely', async () => {
    const docs = []
    await run(docs, payloads, ['A', 'B'])

    await run(docs, { B: payloads.B }, ['A', 'B'])

    expect(docs[0].videoURL).toBe(B_URL)
    expect(docs[0].videoSource).toBe('B')
    expect(docs[0]).not.toHaveProperty('hdr')
  })

  it('ends in the same document in either order after the hand-over', async () => {
    const [first, second] = [[], []]
    const afterLoss = { A: withoutVideo(), B: payloads.B }
    await run(first, payloads, ['A', 'B'])
    await run(first, afterLoss, ['A', 'B'])
    await run(second, payloads, ['B', 'A'])
    await run(second, afterLoss, ['B', 'A'])

    expect(settled(second[0])).toEqual(settled(first[0]))
  })
})

describe('two servers, one of them not answering', () => {
  it('does not clear a video whose server is missing from the run', async () => {
    const docs = []
    await run(docs, { A: withoutVideo(), B: withVideo() }, ['A', 'B'])
    expect(docs[0].videoURL).toBe(B_URL)

    // B is down: only A's payload exists, and it has no video.
    await run(docs, { A: withoutVideo() }, ['A'], { allProbed: false, forceSync: true })

    expect(docs[0].videoURL).toBe(B_URL)
    expect(docs[0].videoSource).toBe('B')
    expect(docs[0].duration).toBe(8160000)
    expect(Object.keys(docs[0].captionURLs)).toEqual(['English'])
  })

  it('does clear it once every server answers and none has the video', async () => {
    const docs = []
    await run(docs, { A: withoutVideo(), B: withVideo() }, ['A', 'B'])

    // B answers and no longer has the folder at all.
    await run(docs, { A: withoutVideo() }, ['A'], { allProbed: true, forceSync: true })

    expect(docs[0].videoURL).toBeNull()
    expect(docs[0]).not.toHaveProperty('duration')
    expect(docs[0]).not.toHaveProperty('captionURLs')
  })
})

describe('two servers with subtitles', () => {
  const english = { English: { url: `${FOLDER}/en.srt`, srcLang: 'en', lastModified: 'm1' } }
  const spanish = { Spanish: { url: `${FOLDER}/es.srt`, srcLang: 'es', lastModified: 'm1' } }

  it.each(ORDERS)('keeps both servers\' languages, synced %s then %s', async (...order) => {
    const payloads = { A: withVideo({ subtitles: english }), B: withVideo({ subtitles: spanish }) }
    const docs = []
    await run(docs, payloads, order)
    await run(docs, payloads, order, { forceSync: true })

    expect(Object.keys(docs[0].captionURLs).sort()).toEqual(['English', 'Spanish'])
    expect(docs[0].captionURLs.English.sourceServerId).toBe('A')
    expect(docs[0].captionURLs.Spanish.sourceServerId).toBe('B')
  })

  it.each(ORDERS)('uses the higher-priority server\'s file for a language both have, synced %s then %s', async (...order) => {
    const payloads = { A: withVideo({ subtitles: english }), B: withVideo({ subtitles: english }) }
    const docs = []
    await run(docs, payloads, order)

    expect(docs[0].captionURLs.English.sourceServerId).toBe('A')
    expect(docs[0].captionURLs.English.url).toMatch(/^https:\/\/A\.example/)
  })

  it.each(ORDERS)('falls back to the other server\'s file when the owner drops the language, synced %s then %s', async (...order) => {
    const docs = []
    await run(docs, { A: withVideo({ subtitles: english }), B: withVideo({ subtitles: english }) }, order)

    await run(docs, { A: withVideo({ subtitles: null }), B: withVideo({ subtitles: english }) }, order)

    expect(docs[0].captionURLs.English.sourceServerId).toBe('B')
  })

  it.each(ORDERS)('removes only the language a server withdrew, synced %s then %s', async (...order) => {
    const docs = []
    await run(docs, { A: withVideo({ subtitles: english }), B: withVideo({ subtitles: spanish }) }, order)

    await run(docs, { A: withVideo({ subtitles: english }), B: withVideo({ subtitles: null }) }, order)

    expect(Object.keys(docs[0].captionURLs)).toEqual(['English'])
  })

  it('ends in the same document in either order', async () => {
    const payloads = { A: withVideo({ subtitles: english }), B: withVideo({ subtitles: { ...english, ...spanish } }) }
    const [first, second] = [[], []]
    await run(first, payloads, ['A', 'B'])
    await run(second, payloads, ['B', 'A'])

    expect(settled(second[0])).toEqual(settled(first[0]))
  })
})

// ---------------------------------------------------------------- the skip gate

describe('skipping an unchanged title', () => {
  const adminUtils = require('@src/utils/admin_utils')
  const statuses = (results) => results.map((r) => r.status)

  it('skips every server on a run in which nothing changed', async () => {
    const payloads = { A: withoutVideo(), B: withVideo() }
    const docs = []
    await run(docs, payloads, ['A', 'B'])
    // Each server has now completed a pass against this picture.
    await run(docs, payloads, ['A', 'B'])
    const before = JSON.stringify(docs[0])

    expect(statuses(await pass(docs, 'A', payloads))).toEqual(['skipped'])
    expect(statuses(await pass(docs, 'B', payloads))).toEqual(['skipped'])
    expect(JSON.stringify(docs[0])).toBe(before)
  })

  it('skips a pass that found nothing to change the first time, instead of repeating it', async () => {
    const payloads = { A: withVideo(), B: withVideo() }
    const docs = []
    await run(docs, payloads, ['A', 'B'])

    // B owns nothing here and wrote nothing, but its pass ran to the end.
    expect(statuses(await pass(docs, 'B', payloads))).toEqual(['skipped'])
  })

  it('does not skip a server whose own payload is unchanged when it has just become the owner', async () => {
    const before = { A: withVideo(), B: withVideo() }
    const docs = []
    await run(docs, before, ['A', 'B'])
    await run(docs, before, ['A', 'B'])
    expect(statuses(await pass(docs, 'B', before))).toEqual(['skipped'])

    // A deletes its file. B's payload is byte for byte what it was.
    const after = { A: withoutVideo(), B: before.B }
    const results = await pass(docs, 'B', after)

    expect(statuses(results)).not.toEqual(['skipped'])
    expect(docs[0].videoURL).toBe(B_URL)
    expect(docs[0].videoSource).toBe('B')
  })

  it('does not skip when a server that owned a field stops answering or comes back', async () => {
    const both = { A: withVideo(), B: withVideo() }
    const docs = []
    await run(docs, both, ['A', 'B'])
    await run(docs, both, ['A', 'B'])

    // A is down: B is the only server with the video this run, and serves it.
    await run(docs, { B: both.B }, ['B'], { allProbed: false })
    expect(docs[0].videoURL).toBe(B_URL)

    // A is back with the same payload it always had, and takes the title back.
    await run(docs, both, ['A', 'B'])
    expect(docs[0].videoURL).toBe(A_URL)
  })

  it('leaves the gate open when the metadata fetch fails, so the next run retries', async () => {
    const docs = []
    await run(docs, { A: withVideo() }, ['A'])

    const changed = withVideo()
    changed.urls.metadata = `${FOLDER}/metadata.json?hash=d9`
    adminUtils.fetchMetadataMultiServer.mockRejectedValueOnce(new Error('file server timed out'))
    await pass(docs, 'A', { A: changed })

    mockMetadata = { id: 603, title: 'The Matrix', overview: 'second attempt' }
    const retry = await pass(docs, 'A', { A: changed })

    expect(statuses(retry)).not.toEqual(['skipped'])
    expect(docs[0].metadata.overview).toBe('second attempt')
    // And once it has succeeded, it is skipped.
    expect(statuses(await pass(docs, 'A', { A: changed }))).toEqual(['skipped'])
  })

  it('still runs everything on a forced sync', async () => {
    const docs = []
    await run(docs, { A: withVideo() }, ['A'])
    const forced = await pass(docs, 'A', { A: withVideo() }, { forceSync: true })
    expect(forced.map((r) => r.operation)).toEqual(['metadata', 'assets', 'content', 'blurhash'])
  })
})

describe('a file-server hash that is ahead of the payload it came with', () => {
  const statuses = (results) => results.map((r) => r.status)

  // A scan can commit between the request for the payload and the request for
  // its hash. The skip decision used to be made on the hash, so the new hash
  // was stamped on a document built from the old payload and the change was
  // skipped from then on. The hash is no longer part of the decision.
  it('changes nothing by itself, and the changed payload is applied when it arrives', async () => {
    const before = withVideo()
    const after = withVideo({ additional_metadata: { duration: 999, dimensions: '1920x1080', size: { gb: 1 } } })
    const docs = []
    await run(docs, { A: before }, ['A'])
    const stored = JSON.stringify(docs[0])

    // Old payload, new hash: nothing to apply, and nothing recorded either.
    expect(statuses(await pass(docs, 'A', { A: before }, { hashesOf: { A: after } }))).toEqual(['skipped'])
    expect(JSON.stringify(docs[0])).toBe(stored)
    // The same on a forced run, which does everything a normal pass would.
    await pass(docs, 'A', { A: before }, { hashesOf: { A: after }, forceSync: true })
    expect(docs[0].duration).toBe(8160000)

    // The payload catches up. Its hash is one this run has already seen.
    const results = await pass(docs, 'A', { A: after })

    expect(statuses(results)).not.toEqual(['skipped'])
    expect(docs[0].duration).toBe(999)
    expect(docs[0].dimensions).toBe('1920x1080')
    // And from here it settles.
    expect(statuses(await pass(docs, 'A', { A: after }))).toEqual(['skipped'])
  })
})

describe('a folder that never held a video', () => {
  it('is stored with its identity and artwork, and no video source', async () => {
    const docs = []
    await run(docs, { A: withoutVideo() }, ['A'])

    expect(docs[0].mediaId).toBe('mid:abc')
    expect(docs[0].posterURL).toMatch(/poster\.jpg/)
    expect(docs[0].videoURL ?? null).toBeNull()
    expect(docs[0]).not.toHaveProperty('videoSource')
    expect(docs[0]).not.toHaveProperty('normalizedVideoId')
  })

  it.each(ORDERS)('ends the same on two servers that both hold only the folder, synced %s then %s', async (...order) => {
    const [once, twice] = [[], []]
    await run(once, { A: withoutVideo(), B: withoutVideo() }, order)
    await run(twice, { A: withoutVideo(), B: withoutVideo() }, order)
    await run(twice, { A: withoutVideo(), B: withoutVideo() }, order, { forceSync: true })

    expect(once[0]).not.toHaveProperty('videoSource')
    expect(settled(twice[0])).toEqual(settled(once[0]))
  })
})

// ---------------------------------------------------------------- a file the server could not probe

describe('a video the file server could not probe this scan', () => {
  // What a processor publishes for a file it cannot read yet (mid-copy, a
  // starved disk): the file is listed, every fact about it is null.
  const unprobed = () => withVideo({ hdr: null, mediaQuality: null, additional_metadata: {} })

  it('keeps the facts already stored instead of clearing them', async () => {
    const docs = []
    await run(docs, { A: withVideo() }, ['A'])

    await run(docs, { A: unprobed() }, ['A'])

    expect(docs[0]).toMatchObject({ videoURL: A_URL, duration: 8160000, dimensions: '3840x2160', hdr: 'HDR10' })
    expect(docs[0].mediaQuality.isHDR).toBe(true)
    expect(docs[0].size).toEqual(expect.any(Number))
  })

  it('takes the facts again once the probe succeeds', async () => {
    const docs = []
    await run(docs, { A: withVideo() }, ['A'])
    await run(docs, { A: unprobed() }, ['A'])

    await run(docs, { A: withVideo({ hdr: null, mediaQuality: SDR_QUALITY }) }, ['A'])

    expect(docs[0]).not.toHaveProperty('hdr')
    expect(docs[0].mediaQuality.isHDR).toBe(false)
  })

  it.each(ORDERS)('does not hand the facts to a lower-priority server meanwhile, synced %s then %s', async (...order) => {
    const docs = []
    const sdrOnB = withVideo({ hdr: null, mediaQuality: SDR_QUALITY })
    await run(docs, { A: withVideo(), B: sdrOnB }, order)

    await run(docs, { A: unprobed(), B: sdrOnB }, order)

    expect(docs[0].videoSource).toBe('A')
    expect(docs[0].hdr).toBe('HDR10')
    expect(docs[0].mediaQuality.isHDR).toBe(true)
  })
})

// ---------------------------------------------------------------- metadata on one server only

describe('two servers, only one of them with a metadata file', () => {
  const withoutMetadataFile = () => {
    const payload = withVideo()
    delete payload.urls.metadata
    return payload
  }

  it.each(ORDERS)('keeps the metadata when the higher-priority server has none, synced %s then %s', async (...order) => {
    const payloads = { A: withoutMetadataFile(), B: withVideo() }
    const docs = []
    await run(docs, payloads, order)
    await run(docs, payloads, order, { forceSync: true })

    expect(docs[0].metadata).toMatchObject({ id: 603, title: 'The Matrix' })
    expect(docs[0].title).toBe('The Matrix')
  })

  it.each(ORDERS)('takes it from the higher-priority server when both have one, synced %s then %s', async (...order) => {
    mockMetadataByServer = {
      A: { id: 603, title: 'The Matrix', overview: 'from A' },
      B: { id: 603, title: 'The Matrix', overview: 'from B' },
    }
    const payloads = { A: withVideo(), B: withVideo() }
    const docs = []
    await run(docs, payloads, order)
    await run(docs, payloads, order, { forceSync: true })

    expect(docs[0].metadata.overview).toBe('from A')
  })

  it('ends in the same document in either order', async () => {
    const payloads = { A: withoutMetadataFile(), B: withVideo() }
    const [first, second] = [[], []]
    await run(first, payloads, ['A', 'B'])
    await run(second, payloads, ['B', 'A'])

    expect(settled(second[0])).toEqual(settled(first[0]))
  })
})

// ---------------------------------------------------------------- a removal held back

describe('a removal held back because a server did not answer', () => {
  const statuses = (results) => results.map((r) => r.status)

  it('is carried out on the next run where every server answers, without a forced sync', async () => {
    const docs = []
    await run(docs, { A: withoutVideo(), B: withVideo() }, ['A', 'B'])
    await run(docs, { A: withoutVideo(), B: withVideo() }, ['A', 'B'])

    // B does not answer. Nobody reports the video; A may not say it is gone.
    await run(docs, { A: withoutVideo() }, ['A'], { allProbed: false })
    expect(docs[0].videoURL).toBe(B_URL)
    // A's pass is not marked complete: there is work it could not do.
    expect(docs[0].syncGates?.A).toBeUndefined()

    // Every server answers, and B no longer has the folder. A's payload and
    // the who-has-what picture are exactly what they were on the last run.
    const results = await pass(docs, 'A', { A: withoutVideo() }, { allProbed: true })

    expect(statuses(results)).not.toEqual(['skipped'])
    expect(docs[0].videoURL).toBeNull()
    expect(docs[0]).not.toHaveProperty('duration')
    expect(docs[0]).not.toHaveProperty('captionURLs')
    // And now it settles.
    expect(statuses(await pass(docs, 'A', { A: withoutVideo() }))).toEqual(['skipped'])
  })

  it('does the same for artwork no answering server reports', async () => {
    const withoutPoster = () => {
      const payload = withVideo()
      delete payload.urls.poster
      return payload
    }
    const docs = []
    await run(docs, { A: withVideo() }, ['A'])

    await run(docs, { A: withoutPoster() }, ['A'], { allProbed: false })
    expect(docs[0].posterURL).toMatch(/poster\.jpg/)
    expect(docs[0].syncGates?.A).toBeUndefined()

    const results = await pass(docs, 'A', { A: withoutPoster() }, { allProbed: true })
    expect(statuses(results)).not.toEqual(['skipped'])
    expect(docs[0]).not.toHaveProperty('posterURL')
  })

  it('does the same for a subtitle whose server stopped answering', async () => {
    const english = { English: { url: `${FOLDER}/en.srt`, srcLang: 'en', lastModified: 'm1' } }
    const spanish = { Spanish: { url: `${FOLDER}/es.srt`, srcLang: 'es', lastModified: 'm1' } }
    const docs = []
    await run(docs, { A: withVideo({ subtitles: english }), B: withVideo({ subtitles: spanish }) }, ['A', 'B'])

    await run(docs, { A: withVideo({ subtitles: english }) }, ['A'], { allProbed: false })
    expect(Object.keys(docs[0].captionURLs)).toEqual(['English', 'Spanish'])
    expect(docs[0].syncGates?.A).toBeUndefined()

    const results = await pass(docs, 'A', { A: withVideo({ subtitles: english }) }, { allProbed: true })
    expect(statuses(results)).not.toEqual(['skipped'])
    expect(Object.keys(docs[0].captionURLs)).toEqual(['English'])
  })
})

// ---------------------------------------------------------------- what is stored for a caption

describe('captions as they are stored', () => {
  const noDate = { English: { url: `${FOLDER}/en.srt`, srcLang: 'en' } }

  it.each([
    ['no lastModified', noDate],
    ['a null lastModified', { English: { ...noDate.English, lastModified: null } }],
  ])('does not rewrite an entry with %s on every run', async (_name, subtitles) => {
    const docs = []
    await run(docs, { A: withVideo({ subtitles }) }, ['A'])
    const before = JSON.stringify(docs[0].captionURLs)

    const forced = await pass(docs, 'A', { A: withVideo({ subtitles }) }, { forceSync: true })

    expect(forced.flatMap((r) => r.changes)).toEqual([])
    expect(JSON.stringify(docs[0].captionURLs)).toBe(before)
  })

  it.each(ORDERS)('lists English first and the rest by name, synced %s then %s', async (...order) => {
    const track = (code) => ({ url: `${FOLDER}/${code}.srt`, srcLang: code, lastModified: 'm1' })
    const payloads = {
      A: withVideo({ subtitles: { Spanish: track('es') } }),
      B: withVideo({ subtitles: { French: track('fr'), English: track('en') } }),
    }
    const docs = []
    await run(docs, payloads, order)

    expect(Object.keys(docs[0].captionURLs)).toEqual(['English', 'French', 'Spanish'])
    // Named from the map, not from whichever server synced last.
    expect(docs[0].captionSource).toBe('B')
  })
})

// ---------------------------------------------------------------- the title, again

describe('the display title with locked metadata', () => {
  it('follows the metadata that is stored, not a copy the lock will discard', async () => {
    const docs = []
    await run(docs, { A: withVideo() }, ['A'])
    docs[0].lockedFields = { metadata: true }

    // TMDB now says something else, and the file server's metadata file changed.
    mockMetadata = { id: 603, title: 'Renamed Upstream', overview: 'y' }
    const changed = withVideo()
    changed.urls.metadata = `${FOLDER}/metadata.json?hash=d9`
    await run(docs, { A: changed }, ['A'])

    expect(docs[0].metadata.title).toBe('The Matrix')
    expect(docs[0].title).toBe('The Matrix')
  })

  it('reports a repaired title as a change, so the page caches for it are refreshed', async () => {
    const docs = []
    await run(docs, { A: withVideo() }, ['A'])
    docs[0].title = KEY

    const results = await pass(docs, 'A', { A: withVideo() }, { forceSync: true })

    expect(docs[0].title).toBe('The Matrix')
    const completed = results.filter((r) => r.status === 'completed')
    expect(completed).toHaveLength(1)
    expect(completed[0].metadata.displayTitle).toBe('The Matrix')
  })
})

// ---------------------------------------------------------------- a video listed only by file name

describe('a video the payload lists by file name only', () => {
  // An older file server: the file is in fileNames, and there is no urls.mp4.
  const byFileNameOnly = () => {
    const payload = withVideo()
    delete payload.urls.mp4
    return payload
  }

  it('is used when no server reports a video URL', async () => {
    const docs = []
    await run(docs, { A: byFileNameOnly() }, ['A'])

    expect(docs[0].videoURL).toMatch(/^https:\/\/A\.example\/movies\/.*The.Matrix\.mkv$/)
    expect(docs[0].videoSource).toBe('A')
  })

  it.each(ORDERS)('gives way to a server that does report one, synced %s then %s', async (...order) => {
    const payloads = { A: byFileNameOnly(), B: withVideo() }
    const docs = []
    await run(docs, payloads, order)
    await run(docs, payloads, order, { forceSync: true })

    expect(docs[0].videoURL).toBe(B_URL)
    expect(docs[0].videoSource).toBe('B')
    expect(docs[0].videoInfoSource).toBe('B')
  })

  it('ends in the same document in either order', async () => {
    const payloads = { A: byFileNameOnly(), B: withVideo() }
    const [first, second] = [[], []]
    await run(first, payloads, ['A', 'B'])
    await run(second, payloads, ['B', 'A'])

    expect(settled(second[0])).toEqual(settled(first[0]))
  })
})

// ---------------------------------------------------------------- who the facts came from

describe('the source of the file facts', () => {
  it.each(ORDERS)('moves with the video when it is handed over, synced %s then %s', async (...order) => {
    // Both files are identical, so nothing about the facts themselves changes.
    const payloads = { A: withVideo(), B: withVideo() }
    const docs = []
    await run(docs, payloads, order)
    expect(docs[0].videoInfoSource).toBe('A')

    await run(docs, { A: withoutVideo(), B: payloads.B }, order)

    expect(docs[0].videoSource).toBe('B')
    expect(docs[0].videoInfoSource).toBe('B')
  })
})

// ---------------------------------------------------------------- the gate's own bookkeeping

describe('the skip gate\'s bookkeeping', () => {
  const statuses = (results) => results.map((r) => r.status)

  it('does not depend on the file server\'s hash being available', async () => {
    const payloads = { A: withVideo(), B: withVideo() }
    const docs = []
    await run(docs, payloads, ['A', 'B'], { hashes: false })
    await run(docs, payloads, ['A', 'B'], { hashes: false })

    expect(statuses(await pass(docs, 'A', payloads, { hashes: false }))).toEqual(['skipped'])
    expect(statuses(await pass(docs, 'B', payloads, { hashes: false }))).toEqual(['skipped'])
  })

  it('keeps the gates through a run on which the hash request failed', async () => {
    const payloads = { A: withVideo(), B: withVideo() }
    const docs = []
    await run(docs, payloads, ['A', 'B'])
    await run(docs, payloads, ['A', 'B'])
    const gates = { ...docs[0].syncGates }
    expect(Object.keys(gates).sort()).toEqual(['A', 'B'])

    // Forced, so both passes run to the end rather than being skipped.
    await run(docs, payloads, ['A', 'B'], { hashes: false, forceSync: true })

    expect(docs[0].syncGates).toEqual(gates)
    expect(docs[0].syncGates.A).toEqual(expect.any(String))
  })

  it('does not skip on a gate written under an older version of the rules', async () => {
    const docs = []
    await run(docs, { A: withVideo() }, ['A'])
    expect(docs[0].syncGates.A).toMatch(/^g\d+:/)
    docs[0].syncGates.A = docs[0].syncGates.A.replace(/^g\d+:/, 'g0:')

    expect(statuses(await pass(docs, 'A', { A: withVideo() }))).not.toEqual(['skipped'])
    // Reprocessed once, then skipped again.
    expect(statuses(await pass(docs, 'A', { A: withVideo() }))).toEqual(['skipped'])
  })

  it('does not skip a document from before gates existed', async () => {
    const docs = []
    await run(docs, { A: withVideo() }, ['A'])
    delete docs[0].syncGates

    expect(statuses(await pass(docs, 'A', { A: withVideo() }))).not.toEqual(['skipped'])
  })
})

// ---------------------------------------------------------------- artwork follows its owner

describe('artwork whose file is identical on two servers', () => {
  // A copy keeps the file's modified time, so the ?hash= on the URL is the
  // same on both servers. Only the host tells the two URLs apart.
  const A_POSTER = `https://A.example${FOLDER}/poster.jpg?hash=p1`
  const B_POSTER = `https://B.example${FOLDER}/poster.jpg?hash=p1`

  it.each(ORDERS)('is the higher-priority server\'s copy, synced %s then %s', async (...order) => {
    const docs = []
    await run(docs, { A: withVideo(), B: withVideo() }, order)

    expect(docs[0]).toMatchObject({ posterURL: A_POSTER, posterSource: 'A', posterBlurhashSource: 'A' })
    expect(docs[0].posterBlurhash).toBe(`blurhash-of:https://A.example${FOLDER}/poster.jpg.blurhash#v1`)
  })

  it('moves to the other server with the title', async () => {
    const docs = []
    await run(docs, { A: withVideo() }, ['A'])
    expect(docs[0].posterURL).toBe(A_POSTER)

    // The folder is moved to B: A answers and no longer has it.
    await run(docs, { B: withVideo() }, ['B'])

    expect(docs[0]).toMatchObject({ videoURL: B_URL, posterURL: B_POSTER, posterSource: 'B', posterBlurhashSource: 'B' })
  })

  it('returns to the higher-priority server that was down when the title was first synced', async () => {
    const payloads = { A: withVideo(), B: withVideo() }
    const [outage, steady] = [[], []]
    await run(outage, { B: payloads.B }, ['B'], { allProbed: false })
    expect(outage[0].posterURL).toBe(B_POSTER)
    await run(outage, payloads, ['A', 'B'])
    await run(steady, payloads, ['A', 'B'])

    expect(outage[0].posterURL).toBe(A_POSTER)
    expect(settled(outage[0])).toEqual(settled(steady[0]))
  })
})

describe('a blurhash the file server could not serve', () => {
  const statuses = (results) => results.map((r) => r.status)
  const blurhashUrl = `https://A.example${FOLDER}/poster.jpg.blurhash`

  it('is fetched on the next run, instead of the title being skipped without it', async () => {
    const docs = []
    mockFailingUrls.add(blurhashUrl)
    await run(docs, { A: withVideo() }, ['A'])
    expect(docs[0]).not.toHaveProperty('posterBlurhash')
    expect(docs[0].syncGates?.A).toBeUndefined()
    // Everything else was stored.
    expect(docs[0].posterURL).toMatch(/poster\.jpg/)

    mockFailingUrls.clear()
    const retry = await pass(docs, 'A', { A: withVideo() })

    expect(statuses(retry)).not.toEqual(['skipped'])
    expect(docs[0].posterBlurhash).toMatch(/^blurhash-of:/)
    expect(statuses(await pass(docs, 'A', { A: withVideo() }))).toEqual(['skipped'])
  })

  it('does not come from a server that does not own the image', async () => {
    // A owns the poster and publishes no blurhash for it; B has both.
    const withoutBlurhash = withVideo()
    delete withoutBlurhash.urls.posterBlurhash
    const payloads = { A: withoutBlurhash, B: withVideo() }
    for (const order of ORDERS) {
      const docs = []
      await run(docs, payloads, order)
      await run(docs, payloads, order, { forceSync: true })

      expect(docs[0].posterSource).toBe('A')
      expect(docs[0]).not.toHaveProperty('posterBlurhash')
    }
  })
})

// ---------------------------------------------------------------- backdrop focal hints

describe('a backdrop focal hint only one server has', () => {
  const statuses = (results) => results.map((r) => r.status)
  // The file server publishes both keys for every movie, null without a hint.
  const hinted = (hint) => withVideo({ backdropFocalSuggested: hint })

  it.each(ORDERS)('is stored, and both servers settle, synced %s then %s', async (...order) => {
    const payloads = { A: hinted(null), B: hinted('left') }
    const docs = []
    await run(docs, payloads, order)
    await run(docs, payloads, order)

    expect(docs[0].backdropFocalSuggested).toBe('left')
    expect(docs[0].backdropFocalSuggestedSource).toBe('B')
    expect(statuses(await pass(docs, 'A', payloads))).toEqual(['skipped'])
    expect(statuses(await pass(docs, 'B', payloads))).toEqual(['skipped'])
  })

  it.each(ORDERS)('is the higher-priority server\'s when both have one, synced %s then %s', async (...order) => {
    const docs = []
    await run(docs, { A: hinted('right'), B: hinted('left') }, order)

    expect(docs[0].backdropFocalSuggested).toBe('right')
    expect(docs[0].backdropFocalSuggestedSource).toBe('A')
  })

  it.each(ORDERS)('is removed once no server has one, synced %s then %s', async (...order) => {
    const docs = []
    await run(docs, { A: hinted(null), B: hinted('left') }, order)

    await run(docs, { A: hinted(null), B: hinted(null) }, order)

    expect(docs[0].backdropFocalSuggested ?? null).toBeNull()
    expect(docs[0]).not.toHaveProperty('backdropFocalSuggestedSource')
  })

  it('is kept while the server that has it is not answering, then removed when it is gone', async () => {
    const docs = []
    await run(docs, { A: hinted(null), B: hinted('left') }, ['A', 'B'])

    await run(docs, { A: hinted(null) }, ['A'], { allProbed: false })
    expect(docs[0].backdropFocalSuggested).toBe('left')

    const results = await pass(docs, 'A', { A: hinted(null) }, { allProbed: true })
    expect(statuses(results)).not.toEqual(['skipped'])
    expect(docs[0].backdropFocalSuggested ?? null).toBeNull()
  })
})

// ---------------------------------------------------------------- when the title entered the library

describe('the library-add date with two servers', () => {
  const seenOn = (firstSeen) =>
    withVideo({ mediaIdentity: { id: 'mid:abc', scheme: 'mid', firstSeen } })
  const EARLY = '2023-03-01T00:00:00.000Z'
  const LATE = '2025-06-01T00:00:00.000Z'

  it.each(ORDERS)('is the earliest date any server holds, synced %s then %s', async (...order) => {
    // The video's owner saw the title later than the other server did.
    const docs = []
    await run(docs, { A: seenOn(LATE), B: seenOn(EARLY) }, order)

    expect(new Date(docs[0].initialDiscoveryDate).toISOString()).toBe(EARLY)
    expect(docs[0].initialDiscoveryServer).toBe('B')
    expect(docs[0].videoSource).toBe('A')
  })

  it('does not depend on which server was down when the title was first synced', async () => {
    const payloads = { A: seenOn(LATE), B: seenOn(EARLY) }
    const [aDown, bDown, steady] = [[], [], []]
    await run(aDown, { B: payloads.B }, ['B'], { allProbed: false })
    await run(aDown, payloads, ['A', 'B'])
    await run(bDown, { A: payloads.A }, ['A'], { allProbed: false })
    await run(bDown, payloads, ['A', 'B'])
    await run(steady, payloads, ['A', 'B'])

    expect(settled(aDown[0])).toEqual(settled(steady[0]))
    expect(settled(bDown[0])).toEqual(settled(steady[0]))
  })

  it.each(ORDERS)('names the higher-priority server when both hold the same date, synced %s then %s', async (...order) => {
    const docs = []
    await run(docs, { A: seenOn(EARLY), B: seenOn(EARLY) }, order)
    await run(docs, { A: seenOn(EARLY), B: seenOn(EARLY) }, order)

    expect(docs[0].initialDiscoveryServer).toBe('A')
  })

  it('is not taken from a server that holds the folder without a video', async () => {
    const placeholder = withoutVideo()
    placeholder.mediaIdentity = { id: 'mid:abc', scheme: 'mid', firstSeen: '2020-01-01T00:00:00.000Z' }
    for (const order of ORDERS) {
      const docs = []
      await run(docs, { A: placeholder, B: seenOn(EARLY) }, order)

      expect(new Date(docs[0].initialDiscoveryDate).toISOString()).toBe(EARLY)
    }
  })
})

// ---------------------------------------------------------------- a hand-over to a file not probed yet

describe('a video handed to a server that has not probed its file yet', () => {
  it.each(ORDERS)('does not keep the previous file\'s facts, synced %s then %s', async (...order) => {
    const docs = []
    const unprobedOnB = withVideo({ file: 'The Matrix 720p.mkv', hdr: null, mediaQuality: null, additional_metadata: {} })
    await run(docs, { A: withVideo(), B: unprobedOnB }, order)
    expect(docs[0].hdr).toBe('HDR10')

    await run(docs, { A: withoutVideo(), B: unprobedOnB }, order)

    expect(docs[0].videoSource).toBe('B')
    for (const field of ['duration', 'dimensions', 'size', 'hdr', 'mediaQuality']) {
      expect(docs[0]).not.toHaveProperty(field)
    }
  })
})

// ---------------------------------------------------------------- three servers

describe('three servers', () => {
  const statuses = (results) => results.map((r) => r.status)
  const ALL_ORDERS = [
    ['A', 'B', 'C'], ['A', 'C', 'B'], ['B', 'A', 'C'], ['B', 'C', 'A'], ['C', 'A', 'B'], ['C', 'B', 'A'],
  ]
  // The main server holds the folder without a video; the other two differ in
  // file, subtitles, hint and first-seen date.
  const payloads = {
    A: withoutVideo(),
    B: withVideo({
      subtitles: { English: { url: `${FOLDER}/en.srt`, srcLang: 'en', lastModified: 'm1' } },
      mediaIdentity: { id: 'mid:abc', scheme: 'mid', firstSeen: '2025-01-01T00:00:00.000Z' },
    }),
    C: withVideo({
      file: 'The Matrix 720p.mkv',
      hdr: null,
      mediaQuality: SDR_QUALITY,
      subtitles: { Spanish: { url: `${FOLDER}/es.srt`, srcLang: 'es', lastModified: 'm1' } },
      backdropFocalSuggested: 'left',
      mediaIdentity: { id: 'mid:abc', scheme: 'mid', firstSeen: '2023-01-01T00:00:00.000Z' },
    }),
  }

  it('end in the same document in every order, and every server is then skipped', async () => {
    const reference = []
    await run(reference, payloads, ALL_ORDERS[0])
    await run(reference, payloads, ALL_ORDERS[0])

    expect(reference[0]).toMatchObject({ videoSource: 'B', posterSource: 'A', hdr: 'HDR10', backdropFocalSuggested: 'left' })
    expect(Object.keys(reference[0].captionURLs)).toEqual(['English', 'Spanish'])

    for (const order of ALL_ORDERS.slice(1)) {
      const docs = []
      await run(docs, payloads, order)
      await run(docs, payloads, order)

      expect(settled(docs[0])).toEqual(settled(reference[0]))
      for (const serverId of order) {
        expect(statuses(await pass(docs, serverId, payloads))).toEqual(['skipped'])
      }
    }
  })

  it('end in that document again after the middle server is down for a run and returns', async () => {
    const steady = []
    await run(steady, payloads, ['A', 'B', 'C'])
    await run(steady, payloads, ['A', 'B', 'C'])

    const docs = []
    await run(docs, payloads, ['A', 'B', 'C'])
    await run(docs, { A: payloads.A, C: payloads.C }, ['A', 'C'], { allProbed: false })
    expect(docs[0].videoSource).toBe('C')
    await run(docs, payloads, ['A', 'B', 'C'])
    await run(docs, payloads, ['A', 'B', 'C'])

    expect(settled(docs[0])).toEqual(settled(steady[0]))
  })
})

// ---------------------------------------------------------------- a blurhash is of one image

describe('a stored blurhash that is not of the stored image', () => {
  const statuses = (results) => results.map((r) => r.status)
  const blurhashUrl = (serverId) => `https://${serverId}.example${FOLDER}/poster.jpg.blurhash`
  const withPoster = (hash) => {
    const payload = withVideo()
    payload.urls.poster = `${FOLDER}/poster.jpg?hash=${hash}`
    return payload
  }

  it('is replaced on the retry when the poster changed and the first fetch failed', async () => {
    const docs = []
    await run(docs, { A: withPoster('p1') }, ['A'])
    expect(docs[0].posterBlurhash).toMatch(/#v1$/)

    // The poster file is replaced; the blurhash for the new one cannot be read yet.
    mockImageVersion = 'v2'
    mockFailingUrls.add(blurhashUrl('A'))
    await run(docs, { A: withPoster('p2') }, ['A'])
    expect(docs[0].posterURL).toMatch(/hash=p2$/)
    // The old poster's blurhash is not kept under the new poster.
    expect(docs[0]).not.toHaveProperty('posterBlurhash')
    expect(docs[0]).not.toHaveProperty('posterBlurhashSource')
    expect(docs[0].syncGates?.A).toBeUndefined()

    mockFailingUrls.clear()
    const retry = await pass(docs, 'A', { A: withPoster('p2') })

    expect(statuses(retry)).not.toEqual(['skipped'])
    expect(docs[0].posterBlurhash).toMatch(/#v2$/)
    expect(statuses(await pass(docs, 'A', { A: withPoster('p2') }))).toEqual(['skipped'])
  })

  it('is replaced when the poster\'s owner returns after an outage and its first fetch fails', async () => {
    const payloads = { A: withVideo(), B: withVideo() }
    const docs = []
    await run(docs, { B: payloads.B }, ['B'], { allProbed: false })
    expect(docs[0].posterBlurhash).toBe(mockBlurhashOf(blurhashUrl('B')))

    mockFailingUrls.add(blurhashUrl('A'))
    await run(docs, payloads, ['A', 'B'])
    expect(docs[0].posterSource).toBe('A')
    // Not B's blurhash under A's poster.
    expect(docs[0]).not.toHaveProperty('posterBlurhash')

    mockFailingUrls.clear()
    await run(docs, payloads, ['A', 'B'])
    expect(docs[0]).toMatchObject({ posterBlurhash: mockBlurhashOf(blurhashUrl('A')), posterBlurhashSource: 'A' })
  })

  it('is removed when the poster changed and the file server has no blurhash for the new one yet', async () => {
    const docs = []
    await run(docs, { A: withPoster('p1') }, ['A'])

    // A new poster file: its blurhash is published one scan later.
    const withoutBlurhash = withPoster('p2')
    delete withoutBlurhash.urls.posterBlurhash
    mockImageVersion = 'v2'
    await run(docs, { A: withoutBlurhash }, ['A'])
    expect(docs[0]).not.toHaveProperty('posterBlurhash')

    await run(docs, { A: withPoster('p2') }, ['A'])
    expect(docs[0].posterBlurhash).toMatch(/#v2$/)
  })

  it('is removed when the poster\'s owner returns and publishes no blurhash for it', async () => {
    const withoutBlurhash = withVideo()
    delete withoutBlurhash.urls.posterBlurhash
    const payloads = { A: withoutBlurhash, B: withVideo() }
    const [outage, steady] = [[], []]
    await run(outage, { B: payloads.B }, ['B'], { allProbed: false })
    expect(outage[0].posterBlurhashSource).toBe('B')
    await run(outage, payloads, ['A', 'B'])
    await run(steady, payloads, ['A', 'B'])

    expect(outage[0]).not.toHaveProperty('posterBlurhash')
    expect(settled(outage[0])).toEqual(settled(steady[0]))
  })

  it('is left alone when an admin locked the poster', async () => {
    const docs = []
    await run(docs, { A: withPoster('p1') }, ['A'])
    Object.assign(docs[0], {
      posterURL: 'https://cdn.example/custom-poster.jpg',
      posterBlurhash: 'CUSTOM',
      lockedFields: { posterURL: true },
    })

    mockImageVersion = 'v2'
    await run(docs, { A: withPoster('p2') }, ['A'])
    await run(docs, { A: withPoster('p2') }, ['A'], { forceSync: true })

    expect(docs[0].posterURL).toBe('https://cdn.example/custom-poster.jpg')
    expect(docs[0].posterBlurhash).toBe('CUSTOM')
  })

  it('is not written for a poster an admin locked, even when none is stored', async () => {
    // Both attempts at a blurhash (the asset strategy's and the blurhash
    // strategy's) must stand down: the file server's blurhash is not of the
    // admin's image.
    const docs = []
    await run(docs, { A: withPoster('p1') }, ['A'])
    delete docs[0].posterBlurhash
    delete docs[0].posterBlurhashSource
    delete docs[0].syncGates
    Object.assign(docs[0], { posterURL: 'https://cdn.example/custom-poster.jpg', lockedFields: { posterURL: true } })

    await run(docs, { A: withPoster('p1') }, ['A'])
    await run(docs, { A: withPoster('p1') }, ['A'], { forceSync: true })

    expect(docs[0]).not.toHaveProperty('posterBlurhash')
    expect(docs[0]).not.toHaveProperty('posterBlurhashSource')
  })

  it('is not written, nor its source, when an admin locked the blurhash itself', async () => {
    const docs = []
    await run(docs, { A: withPoster('p1') }, ['A'])
    delete docs[0].posterBlurhash
    delete docs[0].posterBlurhashSource
    delete docs[0].syncGates
    docs[0].lockedFields = { posterBlurhash: true }

    await run(docs, { A: withPoster('p1') }, ['A'])
    const forced = await pass(docs, 'A', { A: withPoster('p1') }, { forceSync: true })

    expect(docs[0]).not.toHaveProperty('posterBlurhash')
    expect(docs[0]).not.toHaveProperty('posterBlurhashSource')
    expect(forced.flatMap((r) => r.changes)).toEqual([])
  })
})

// ---------------------------------------------------------------- sources after an outage

describe('source fields after the owner was down when the title was first synced', () => {
  // Each source field names the server its value belongs to. With identical
  // values on both servers nothing but the source can differ, and it used to
  // stay with whichever server had synced first.
  const outageThenSteady = async (payloads) => {
    const [outage, steady] = [[], []]
    await run(outage, { B: payloads.B }, ['B'], { allProbed: false })
    await run(outage, payloads, ['A', 'B'])
    await run(outage, payloads, ['A', 'B'])
    await run(steady, payloads, ['A', 'B'])
    await run(steady, payloads, ['A', 'B'])
    return [outage[0], steady[0]]
  }

  it('name the owner of a focal hint both servers hold', async () => {
    const hinted = () => withVideo({ backdropFocalSuggested: 'left' })
    const [outage, steady] = await outageThenSteady({ A: hinted(), B: hinted() })

    expect(outage.backdropFocalSuggestedSource).toBe('A')
    expect(settled(outage)).toEqual(settled(steady))
  })

  it('name the server that has the folder, for a title with no metadata anywhere', async () => {
    mockMetadata = null
    const payloads = { A: withVideo(), B: withVideo() }
    const [outage, steady] = await outageThenSteady(payloads)
    const reversed = []
    await run(reversed, payloads, ['B', 'A'])
    await run(reversed, payloads, ['B', 'A'])

    expect(outage.title).toBe(KEY)
    expect(outage.titleSource).toBe('A')
    expect(reversed[0].titleSource).toBe('A')
    // The stub the failed metadata fetch leaves is stamped with the time of
    // the attempt; everything else must match.
    const withoutStub = (doc) => ({ ...settled(doc), metadata: undefined })
    expect(withoutStub(outage)).toEqual(withoutStub(steady))
    expect(withoutStub(reversed[0])).toEqual(withoutStub(steady))
  })

  it('name the owner of a title that equals the folder name', async () => {
    mockMetadata = { id: 603, title: KEY, overview: 'x' }
    const [outage, steady] = await outageThenSteady({ A: withVideo(), B: withVideo() })

    expect(outage.titleSource).toBe('A')
    expect(outage.metadataSource).toBe('A')
    expect(settled(outage)).toEqual(settled(steady))
  })

  it('leave no key of the stand-in server\'s metadata behind, with or without hashes', async () => {
    mockMetadataByServer = {
      A: { id: 603, title: 'The Matrix', overview: 'x' },
      B: { id: 603, title: 'The Matrix', overview: 'x', tagline: 'only on B' },
    }
    const payloads = { A: withVideo(), B: withVideo() }
    for (const hashes of [true, false]) {
      const docs = []
      await run(docs, { B: payloads.B }, ['B'], { allProbed: false, hashes })
      expect(docs[0].metadata.tagline).toBe('only on B')

      await run(docs, payloads, ['A', 'B'], { hashes })

      expect(docs[0].metadataSource).toBe('A')
      expect(docs[0].metadata).not.toHaveProperty('tagline')
    }
  })

  it('do not make a settled title refetch its metadata', async () => {
    const adminUtils = require('@src/utils/admin_utils')
    const payloads = { A: withVideo(), B: withVideo() }
    const docs = []
    await run(docs, payloads, ['A', 'B'])
    await run(docs, payloads, ['A', 'B'])
    adminUtils.fetchMetadataMultiServer.mockClear()

    // Forced, so every strategy runs; the metadata file is still not fetched.
    await run(docs, payloads, ['A', 'B'], { forceSync: true })

    const metadataFetches = adminUtils.fetchMetadataMultiServer.mock.calls.filter(([, , type]) => type !== 'blurhash')
    expect(metadataFetches).toEqual([])
  })
})

describe('a focal hint an admin locked', () => {
  it('is kept when no server has one, and nothing is reported as cleared', async () => {
    const docs = []
    await run(docs, { A: withVideo({ backdropFocal: 'top' }) }, ['A'])
    docs[0].lockedFields = { backdropFocal: true }

    const results = await pass(docs, 'A', { A: withVideo({ backdropFocal: null }) })

    expect(docs[0].backdropFocal).toBe('top')
    expect(docs[0].backdropFocalSource).toBe('A')
    expect(results.flatMap((r) => r.changes).join(' ')).not.toMatch(/backdropFocal/)
  })
})
