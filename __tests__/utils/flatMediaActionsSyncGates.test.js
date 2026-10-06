/**
 * @jest-environment node
 *
 * The sync skips a title while its `syncGates` say the document is the one the
 * last complete pass left. An admin edit changes the document behind the
 * sync's back — a field that was unlocked, for one, is the sync's to write
 * again — so every edit has to reopen the gates, or the next runs are skipped
 * and the edit's effect on the sync never happens.
 */

jest.mock('@src/utils/routeAuth', () => ({ isAdmin: jest.fn(async () => ({ id: 'admin' })) }))
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))
jest.mock('@src/utils/flatDatabaseUtils', () => ({ generateNormalizedVideoId: jest.fn(() => 'nid') }))
jest.mock('@src/utils/cache/invalidation', () => ({
  invalidateMovieDetailsCache: jest.fn(),
  invalidateTVShowDetailsCache: jest.fn(),
  invalidateSeasonDetailsCache: jest.fn(),
  invalidateEpisodeDetailsCache: jest.fn(),
}))

const mockUpdates = []
const mockDocs = {}
jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({
    db: () => ({
      collection: (name) => ({
        findOne: async () => mockDocs[name] ?? null,
        updateOne: async (filter, update) => {
          mockUpdates.push({ collection: name, filter, update })
          return { matchedCount: 1 }
        },
        updateMany: async () => ({ modifiedCount: 0 }),
        insertOne: async () => ({ acknowledged: true }),
        deleteOne: async () => ({ deletedCount: 1 }),
        deleteMany: async () => ({ deletedCount: 0 }),
      }),
    }),
  }),
}))

const { ObjectId } = require('mongodb')
const {
  saveMovieAction,
  saveTVShowAction,
  saveSeasonAction,
  saveEpisodeAction,
  deleteSeasonAction,
  deleteEpisodeAction,
} = require('@src/utils/admin/flatMediaActions')

const id = () => new ObjectId().toString()
const updatesTo = (collection) => mockUpdates.filter((u) => u.collection === collection)
const reopensGates = (update) => update.$unset && 'syncGates' in update.$unset

beforeEach(() => {
  mockUpdates.length = 0
  for (const key of Object.keys(mockDocs)) delete mockDocs[key]
})

describe('an admin edit reopens the sync\'s skip gates', () => {
  it('on the movie that was edited', async () => {
    const movieId = id()
    mockDocs.FlatMovies = { _id: new ObjectId(movieId), title: 'Film', originalTitle: 'Film (2000)', syncGates: { A: 'g1:x#y' } }

    const result = await saveMovieAction(null, { id: movieId, lockedFields: {} })

    expect(result.status).toBe('success')
    expect(updatesTo('FlatMovies')).toHaveLength(1)
    expect(reopensGates(updatesTo('FlatMovies')[0].update)).toBe(true)
  })

  it('on the show that was edited', async () => {
    const showId = id()
    mockDocs.FlatTVShows = { _id: new ObjectId(showId), title: 'Show', originalTitle: 'Show (2008)' }

    const result = await saveTVShowAction(null, { id: showId, lockedFields: {} })

    expect(result.status).toBe('success')
    expect(reopensGates(updatesTo('FlatTVShows')[0].update)).toBe(true)
  })

  it('on the show when one of its seasons was edited', async () => {
    // A show is skipped as a whole on the SHOW's gate.
    const showId = id()
    mockDocs.FlatTVShows = { _id: new ObjectId(showId), title: 'Show', originalTitle: 'Show (2008)' }
    mockDocs.FlatSeasons = { _id: new ObjectId(), showId: new ObjectId(showId), seasonNumber: 1 }

    const result = await saveSeasonAction(null, { showId, seasonNumber: 1, lockedFields: {} })

    expect(result.status).toBe('success')
    expect(updatesTo('FlatSeasons')).toHaveLength(1)
    expect(updatesTo('FlatTVShows').some((u) => reopensGates(u.update))).toBe(true)
  })

  it('on the episode that was edited, and on its show', async () => {
    const showId = id()
    mockDocs.FlatTVShows = { _id: new ObjectId(showId), title: 'Show', originalTitle: 'Show (2008)' }
    mockDocs.FlatSeasons = { _id: new ObjectId(), showId: new ObjectId(showId), seasonNumber: 1 }
    mockDocs.FlatEpisodes = { _id: new ObjectId(), showId: new ObjectId(showId), seasonNumber: 1, episodeNumber: 2 }

    const result = await saveEpisodeAction(null, { showId, seasonNumber: 1, episodeNumber: 2, lockedFields: {} })

    expect(result.status).toBe('success')
    expect(reopensGates(updatesTo('FlatEpisodes')[0].update)).toBe(true)
    expect(updatesTo('FlatTVShows').some((u) => reopensGates(u.update))).toBe(true)
  })

  it('on the show when an episode is deleted, so one a file server still has is synced back', async () => {
    // The show's own check for missing episodes only counts them, and a manual
    // episode can make up the number.
    const showId = id()
    const episodeId = id()
    mockDocs.FlatEpisodes = { _id: new ObjectId(episodeId), showId: new ObjectId(showId), seasonNumber: 1, episodeNumber: 2 }

    const result = await deleteEpisodeAction(null, { episodeId, showId })

    expect(result.status).toBe('success')
    expect(updatesTo('FlatTVShows').some((u) => reopensGates(u.update))).toBe(true)
  })

  it('on the show when a season is deleted', async () => {
    const showId = id()
    mockDocs.FlatTVShows = { _id: new ObjectId(showId), title: 'Show', originalTitle: 'Show (2008)' }

    const result = await deleteSeasonAction(null, { showId, seasonNumber: 1 })

    expect(result.status).toBe('success')
    expect(updatesTo('FlatTVShows').some((u) => reopensGates(u.update))).toBe(true)
  })

  it('on the show when a season or an episode is added by hand', async () => {
    const showId = id()
    mockDocs.FlatTVShows = { _id: new ObjectId(showId), title: 'Show', originalTitle: 'Show (2008)' }

    expect((await saveSeasonAction(null, { showId, seasonNumber: 3 })).status).toBe('success')
    expect(updatesTo('FlatTVShows').filter((u) => reopensGates(u.update))).toHaveLength(1)

    mockDocs.FlatSeasons = { _id: new ObjectId(), showId: new ObjectId(showId), seasonNumber: 3 }
    mockDocs.FlatEpisodes = null
    expect((await saveEpisodeAction(null, { showId, seasonNumber: 3, episodeNumber: 1 })).status).toBe('success')
    expect(updatesTo('FlatTVShows').filter((u) => reopensGates(u.update))).toHaveLength(2)
  })
})
