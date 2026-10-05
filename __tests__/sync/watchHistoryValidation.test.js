/**
 * @jest-environment node
 *
 * A watch-history record is valid only while the title it points at has a
 * video. A movie whose file was deleted on the file server, with its folder
 * kept, stays in FlatMovies without a videoURL but with its mediaId and its
 * last normalizedVideoId. The validation counted those identifiers, so the
 * record for the deleted file stayed valid, took a slot in the recently-watched
 * page and rendered nothing: a page of 8 came back with 7.
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

const {
  validateWatchHistoryAgainstDatabase,
  catalogDocHasVideo,
} = require('@src/utils/flatSync/watchHistoryValidation')

// Just enough of MongoDB's matching for the filters the validation issues.
// A missing field matches $nin and $ne and does not match $in, as in MongoDB.
function matches(doc, filter) {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') return condition.some((branch) => matches(doc, branch))
    const value = doc[key]
    if (condition === null || typeof condition !== 'object') return value === condition
    return Object.entries(condition).every(([op, operand]) => {
      if (op === '$in') return operand.includes(value)
      if (op === '$nin') return !operand.includes(value)
      if (op === '$ne') return value !== operand
      if (op === '$exists') return (value !== undefined) === operand
      throw new Error(`unsupported operator ${op}`)
    })
  })
}

async function* streamOf(docs) {
  for (const doc of docs) yield doc
}

function installCatalog({ movies = [], episodes = [], history }) {
  mockCollections.FlatMovies = { find: () => streamOf(movies) }
  mockCollections.FlatEpisodes = { find: () => streamOf(episodes) }
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

// What the sync leaves behind when a movie's file is deleted and its folder kept.
const movieWithoutVideo = {
  videoURL: null,
  normalizedVideoId: '7148b0d8e508b082',
  mediaId: 'mid:2fcc7a0e4a9bae53',
}
const movieWithVideo = {
  videoURL: 'https://files.example.com/movies/Mutiny/Mutiny.2026.mkv',
  normalizedVideoId: 'dfbc3ec5b933e881',
  mediaId: 'mid:aaaaaaaaaaaaaaaa',
}

const rowFor = (movie, extra = {}) => ({
  _id: `row-${movie.normalizedVideoId}`,
  videoId: movie.videoURL ?? FILE_URL,
  normalizedVideoId: movie.normalizedVideoId,
  mediaId: movie.mediaId,
  isValid: true,
  ...extra,
})

describe('catalogDocHasVideo', () => {
  it('is true only for a document with a video URL', () => {
    expect(catalogDocHasVideo(movieWithVideo)).toBe(true)
    expect(catalogDocHasVideo(movieWithoutVideo)).toBe(false)
    expect(catalogDocHasVideo({ videoURL: '' })).toBe(false)
    expect(catalogDocHasVideo({ mediaId: 'mid:x' })).toBe(false)
    expect(catalogDocHasVideo(null)).toBe(false)
  })
})

describe('validateWatchHistoryAgainstDatabase', () => {
  it('marks a record invalid when its title is still in the catalog but has no video', async () => {
    const odyssey = rowFor(movieWithoutVideo)
    const mutiny = rowFor(movieWithVideo)
    installCatalog({ movies: [movieWithoutVideo, movieWithVideo], history: [odyssey, mutiny] })

    const results = await validateWatchHistoryAgainstDatabase()

    expect(odyssey.isValid).toBe(false)
    expect(mutiny.isValid).toBe(true)
    expect(results).toMatchObject({ markedInvalid: 1, markedValid: 0, errors: [] })
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
      videoURL: 'https://files.example.com/movies/The%20Odyssey/The.Odyssey.2026.2160p.mkv',
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
      normalizedVideoId: 'eeeeeeeeeeeeeeee',
      mediaId: 'mid:bbbbbbbbbbbbbbbb:s01e01',
    }
    const row = rowFor(episodeWithoutVideo)
    installCatalog({ episodes: [episodeWithoutVideo], history: [row] })

    await validateWatchHistoryAgainstDatabase()

    expect(row.isValid).toBe(false)
  })

  it('still validates a record that predates mediaId, on its normalizedVideoId', async () => {
    const legacyValid = { _id: 'a', videoId: movieWithVideo.videoURL, normalizedVideoId: movieWithVideo.normalizedVideoId }
    const legacyGone = { _id: 'b', videoId: 'https://files.example.com/movies/Gone/Gone.mkv', normalizedVideoId: '0000000000000000', isValid: true }
    installCatalog({ movies: [movieWithVideo], history: [legacyValid, legacyGone] })

    await validateWatchHistoryAgainstDatabase()

    expect(legacyValid.isValid).toBe(true)
    expect(legacyGone.isValid).toBe(false)
  })

  it('leaves a record alone when its state is already right', async () => {
    const valid = rowFor(movieWithVideo, { isValid: true, lastScanned: 'earlier' })
    const invalid = rowFor(movieWithoutVideo, { isValid: false, lastScanned: 'earlier' })
    installCatalog({ movies: [movieWithVideo, movieWithoutVideo], history: [valid, invalid] })

    const results = await validateWatchHistoryAgainstDatabase()

    expect(results).toMatchObject({ markedValid: 0, markedInvalid: 0 })
    expect(valid.lastScanned).toBe('earlier')
    expect(invalid.lastScanned).toBe('earlier')
  })
})
