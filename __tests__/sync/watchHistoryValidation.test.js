/**
 * @jest-environment node
 *
 * A watch-history record is valid only while the title it points at can be
 * shown. The recently-watched list pages over valid records and then looks
 * each one up among the titles that pass the visibility rule; a valid record
 * whose title fails it takes a slot in the page and renders nothing, so a page
 * of 8 came back with 7.
 *
 * The case that started this: a movie whose file was deleted on the file
 * server, with its folder kept. It stays in FlatMovies without a videoURL but
 * with its mediaId and its last normalizedVideoId, and the validation counted
 * those.
 */

const mockCollections = {}

jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({
    db: () => ({ collection: (name) => mockCollections[name] }),
  }),
}))
jest.mock('@src/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  logError: jest.fn(),
}))
jest.mock('@src/utils/flatDatabaseUtils', () => ({
  generateNormalizedVideoId: (url) => `nid-of:${url}`,
}))
jest.mock('@src/utils/watchHistory/database', () => ({
  findPlaybackForUser: jest.fn(),
  updateValidationStatus: jest.fn(),
}))

const { validateWatchHistoryAgainstDatabase, VOUCHING_FILTERS } = require('@src/utils/flatSync/watchHistoryValidation')
const { visibleMovieFilter, visibleEpisodeFilter } = require('@src/utils/mediaVisibility')

// Just enough of MongoDB's matching for the filters the validation issues,
// including the visibility fragments. A missing field matches $nin and $ne and
// does not match $in, as in MongoDB.
function matches(doc, filter) {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') return condition.some((branch) => matches(doc, branch))
    if (key === '$and') return condition.every((branch) => matches(doc, branch))
    if (key === '$nor') return !condition.some((branch) => matches(doc, branch))
    const value = doc[key]
    if (condition instanceof RegExp) return typeof value === 'string' && condition.test(value)
    if (condition === null || typeof condition !== 'object') return value === condition
    return Object.entries(condition).every(([op, operand]) => {
      if (op === '$in') return operand.includes(value)
      if (op === '$nin') return !operand.includes(value)
      if (op === '$ne') return value !== operand
      if (op === '$exists') return (value !== undefined) === operand
      if (op === '$type') return operand === 'string' && typeof value === 'string'
      throw new Error(`unsupported operator ${op}`)
    })
  })
}

async function* streamOf(docs) {
  for (const doc of docs) yield doc
}

function installCatalog({ movies = [], episodes = [], history }) {
  const catalog = (docs) => ({
    find: (filter = {}) => streamOf(docs.filter((doc) => matches(doc, filter))),
    countDocuments: async (filter = {}) => docs.filter((doc) => matches(doc, filter)).length,
  })
  mockCollections.FlatMovies = catalog(movies)
  mockCollections.FlatEpisodes = catalog(episodes)
  mockCollections.WatchHistory = {
    find: (filter) => streamOf(history.filter((row) => matches(row, filter))),
    updateMany: async (filter, update) => {
      const hit = history.filter((row) => matches(row, filter))
      hit.forEach((row) => Object.assign(row, update.$set))
      return { modifiedCount: hit.length }
    },
    updateOne: async (filter, update) => {
      const row = history.find((candidate) => matches(candidate, filter))
      if (row) Object.assign(row, update.$set)
      return { modifiedCount: row ? 1 : 0 }
    },
  }
}

const FILE_URL = 'https://files.example.com/movies/The%20Odyssey/The.Odyssey.2026.mkv'

// What the sync leaves when a movie's file is deleted and its folder kept.
const movieWithoutVideo = {
  videoURL: null,
  primaryContainer: null,
  jitUrl: null,
  jitEligible: false,
  normalizedVideoId: '7148b0d8e508b082',
  mediaId: 'mid:2fcc7a0e4a9bae53',
}
// An mkv served through the transcoder.
const playableMovie = {
  videoURL: 'https://files.example.com/movies/Mutiny/Mutiny.2026.mkv',
  primaryContainer: 'mkv',
  jitUrl: 'https://transcoder.example.com/stream/abc/master.m3u8',
  jitEligible: true,
  normalizedVideoId: 'dfbc3ec5b933e881',
  mediaId: 'mid:aaaaaaaaaaaaaaaa',
}
// The same kind of file with the transcoder switched off at its host: it has a
// video, and no list can show it.
const unplayableMovie = {
  videoURL: 'https://files.example.com/movies/Remux/Remux.2160p.mkv',
  primaryContainer: 'mkv',
  jitUrl: null,
  jitEligible: false,
  normalizedVideoId: 'cccccccccccccccc',
  mediaId: 'mid:cccccccccccccccc',
}
const mp4Movie = {
  videoURL: 'https://files.example.com/movies/Plain/Plain.mp4',
  primaryContainer: 'mp4',
  normalizedVideoId: 'eeeeeeeeeeeeeeee',
  mediaId: 'mid:eeeeeeeeeeeeeeee',
}

const rowFor = (title, extra = {}) => ({
  _id: `row-${title.normalizedVideoId}`,
  videoId: title.videoURL ?? FILE_URL,
  normalizedVideoId: title.normalizedVideoId,
  mediaId: title.mediaId,
  isValid: true,
  ...extra,
})

describe('which documents vouch', () => {
  it('uses the list\'s own visibility rule, for movies and for episodes', () => {
    expect(VOUCHING_FILTERS.FlatMovies).toBe(visibleMovieFilter)
    expect(VOUCHING_FILTERS.FlatEpisodes).toBe(visibleEpisodeFilter)
  })
})

describe('validateWatchHistoryAgainstDatabase', () => {
  it('marks a record invalid when its title is still in the catalog but has no video', async () => {
    const odyssey = rowFor(movieWithoutVideo)
    const mutiny = rowFor(playableMovie)
    installCatalog({ movies: [movieWithoutVideo, playableMovie], history: [odyssey, mutiny] })

    const results = await validateWatchHistoryAgainstDatabase()

    expect(odyssey.isValid).toBe(false)
    expect(mutiny.isValid).toBe(true)
    expect(results).toMatchObject({ markedInvalid: 1, markedValid: 0, errors: [] })
  })

  it('marks a record invalid when its title has a video no list can show', async () => {
    const remux = rowFor(unplayableMovie)
    const plain = rowFor(mp4Movie)
    installCatalog({ movies: [unplayableMovie, mp4Movie], history: [remux, plain] })

    await validateWatchHistoryAgainstDatabase()

    expect(remux.isValid).toBe(false)
    expect(plain.isValid).toBe(true)
  })

  it('marks it valid again when the title becomes playable', async () => {
    const row = rowFor(unplayableMovie, { isValid: false })
    const transcoderBackOn = { ...unplayableMovie, jitUrl: 'https://transcoder.example.com/stream/x/master.m3u8', jitEligible: true }
    installCatalog({ movies: [transcoderBackOn], history: [row] })

    await validateWatchHistoryAgainstDatabase()

    expect(row.isValid).toBe(true)
  })

  it('does not let a video-less title vouch through its mediaId alone', async () => {
    // A record written under an older URL for the same folder: only the durable
    // identity ties it to the title.
    const row = rowFor(movieWithoutVideo, { normalizedVideoId: 'older-nid-for-same-folder' })
    installCatalog({ movies: [movieWithoutVideo], history: [row] })

    await validateWatchHistoryAgainstDatabase()

    expect(row.isValid).toBe(false)
  })

  it('marks the record valid again when a video returns under the same identity', async () => {
    const row = rowFor(movieWithoutVideo, { isValid: false })
    // The replacement file has a new URL and nid; the folder's mediaId is unchanged.
    const restored = {
      videoURL: 'https://files.example.com/movies/The%20Odyssey/The.Odyssey.2026.2160p.mp4',
      primaryContainer: 'mp4',
      normalizedVideoId: 'ffffffffffffffff',
      mediaId: movieWithoutVideo.mediaId,
    }
    installCatalog({ movies: [restored], history: [row] })

    const results = await validateWatchHistoryAgainstDatabase()

    expect(row.isValid).toBe(true)
    expect(results.markedValid).toBe(1)
  })

  it('applies the same rule to episodes', async () => {
    const episodeWithoutVideo = {
      videoURL: null,
      primaryContainer: null,
      normalizedVideoId: 'eeeeeeeeeeeeeeee',
      mediaId: 'mid:bbbbbbbbbbbbbbbb:s01e01',
    }
    const row = rowFor(episodeWithoutVideo)
    installCatalog({ episodes: [episodeWithoutVideo], history: [row] })

    await validateWatchHistoryAgainstDatabase()

    expect(row.isValid).toBe(false)
  })

  it('still validates a record that predates mediaId, on its normalizedVideoId', async () => {
    const legacyValid = { _id: 'a', videoId: playableMovie.videoURL, normalizedVideoId: playableMovie.normalizedVideoId }
    const legacyGone = { _id: 'b', videoId: 'https://files.example.com/movies/Gone/Gone.mkv', normalizedVideoId: '0000000000000000', isValid: true }
    installCatalog({ movies: [playableMovie], history: [legacyValid, legacyGone] })

    await validateWatchHistoryAgainstDatabase()

    expect(legacyValid.isValid).toBe(true)
    expect(legacyGone.isValid).toBe(false)
  })

  it('still counts a title that has not been resynced since containers were recorded', async () => {
    // No primaryContainer field at all: judged on its URL, as the lists do.
    const legacyDoc = { videoURL: 'https://files.example.com/movies/Old/Old.mp4', normalizedVideoId: '1111111111111111' }
    const row = rowFor(legacyDoc)
    installCatalog({ movies: [legacyDoc], history: [row] })

    await validateWatchHistoryAgainstDatabase()

    expect(row.isValid).toBe(true)
  })

  it('leaves a record alone when its state is already right', async () => {
    const valid = rowFor(playableMovie, { isValid: true, lastScanned: 'earlier' })
    const invalid = rowFor(movieWithoutVideo, { isValid: false, lastScanned: 'earlier' })
    installCatalog({ movies: [playableMovie, movieWithoutVideo], history: [valid, invalid] })

    const results = await validateWatchHistoryAgainstDatabase()

    expect(results).toMatchObject({ markedValid: 0, markedInvalid: 0 })
    expect(valid.lastScanned).toBe('earlier')
    expect(invalid.lastScanned).toBe('earlier')
  })
})
