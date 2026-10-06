/**
 * @jest-environment node
 *
 * After cleanup deletes the episodes that left the file server, the show's
 * stored count of visible episodes has to be counted again. The show sync
 * counts while those episodes are still in the database, and later runs skip
 * the unchanged show, so a show whose every episode was removed stayed listed
 * with a count that said it had some.
 */

jest.mock('@opentelemetry/api', () => ({
  trace: { getTracer: () => ({ startActiveSpan: (_name, fn) => fn({ setAttribute() {}, setAttributes() {}, end() {} }) }) },
}))
jest.mock('@src/lib/mongodb', () => ({ __esModule: true, default: Promise.resolve({}) }))
jest.mock('@src/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  logError: jest.fn(),
}))
jest.mock('@src/utils/watchHistory/migrate', () => ({ migratePlaybackStatusIfNeeded: jest.fn() }))
jest.mock('@src/utils/flatSync/watchHistoryValidation', () => ({ validateWatchHistoryAgainstDatabase: jest.fn() }))
jest.mock('@src/utils/flatSync/syncContext', () => ({ getCurrentSyncRunId: jest.fn(), getSyncLockHolder: jest.fn() }))
jest.mock('@src/utils/flatSync/preTagSyncRunId', () => ({ isCollectionFullyCovered: jest.fn() }))
jest.mock('@src/utils/cache/postSyncRevalidation', () => ({ requestMediaRevalidation: jest.fn() }))

const { recountVisibleEpisodes } = require('@src/utils/flatSync/postSyncCleanup')

function matches(doc, filter) {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') return condition.some((branch) => matches(doc, branch))
    if (key === '$and') return condition.every((branch) => matches(doc, branch))
    const value = doc[key]
    if (condition instanceof RegExp) return typeof value === 'string' && condition.test(value)
    if (condition === null || typeof condition !== 'object') return value === condition
    return Object.entries(condition).every(([op, operand]) => {
      if (op === '$in') return operand.includes(value)
      if (op === '$ne') return value !== operand
      if (op === '$exists') return (value !== undefined) === operand
      if (op === '$type') return operand === 'string' && typeof value === 'string'
      throw new Error(`unsupported operator ${op}`)
    })
  })
}

function makeDb({ shows, episodes }) {
  const writes = []
  const collections = {
    FlatTVShows: {
      findOne: async (filter) => shows.find((d) => matches(d, filter)) ?? null,
      updateOne: async (filter, update) => {
        const doc = shows.find((d) => matches(d, filter))
        if (doc) Object.assign(doc, update.$set)
        writes.push({ filter, update })
        return { matchedCount: doc ? 1 : 0 }
      },
    },
    FlatEpisodes: {
      countDocuments: async (filter) => episodes.filter((d) => matches(d, filter)).length,
    },
  }
  return { db: { collection: (name) => collections[name] }, writes }
}

const playable = (showId, n) => ({ showId, episodeNumber: n, videoURL: `https://files.example.com/e${n}.mp4`, primaryContainer: 'mp4' })
const unplayable = (showId, n) => ({ showId, episodeNumber: n, videoURL: `https://files.example.com/e${n}.mkv`, primaryContainer: 'mkv', jitUrl: null })

describe('recountVisibleEpisodes', () => {
  it('sets an emptied show\'s count to zero', async () => {
    const shows = [{ _id: 'show-1', visibleEpisodeCount: 8 }]
    const { db } = makeDb({ shows, episodes: [] })

    expect(await recountVisibleEpisodes(db, ['show-1', 'show-1', 'show-1'])).toBe(1)
    expect(shows[0].visibleEpisodeCount).toBe(0)
  })

  it('counts only the episodes a list can show', async () => {
    const shows = [{ _id: 'show-1', visibleEpisodeCount: 5 }]
    const episodes = [playable('show-1', 1), playable('show-1', 2), unplayable('show-1', 3), playable('show-2', 1)]
    const { db } = makeDb({ shows, episodes })

    await recountVisibleEpisodes(db, ['show-1'])
    expect(shows[0].visibleEpisodeCount).toBe(2)
  })

  it('writes nothing when the stored count is already right', async () => {
    const shows = [{ _id: 'show-1', visibleEpisodeCount: 1 }]
    const { db, writes } = makeDb({ shows, episodes: [playable('show-1', 1)] })

    expect(await recountVisibleEpisodes(db, ['show-1'])).toBe(0)
    expect(writes).toEqual([])
  })

  it('touches only the shows that lost episodes', async () => {
    const shows = [{ _id: 'show-1', visibleEpisodeCount: 3 }, { _id: 'show-2', visibleEpisodeCount: 99 }]
    const { db } = makeDb({ shows, episodes: [playable('show-1', 1)] })

    await recountVisibleEpisodes(db, ['show-1'])
    expect(shows[0].visibleEpisodeCount).toBe(1)
    expect(shows[1].visibleEpisodeCount).toBe(99)
  })

  it('skips a show that was itself deleted, and an episode with no show id', async () => {
    const { db, writes } = makeDb({ shows: [], episodes: [] })

    expect(await recountVisibleEpisodes(db, ['gone-show', null, undefined])).toBe(0)
    expect(writes).toEqual([])
  })

  it('does nothing for an empty list', async () => {
    const { db, writes } = makeDb({ shows: [{ _id: 'show-1', visibleEpisodeCount: 2 }], episodes: [] })
    expect(await recountVisibleEpisodes(db, [])).toBe(0)
    expect(await recountVisibleEpisodes(db, undefined)).toBe(0)
    expect(writes).toEqual([])
  })
})
