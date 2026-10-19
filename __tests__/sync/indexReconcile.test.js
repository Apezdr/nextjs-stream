/**
 * @jest-environment node
 *
 * An index an older version created with other options (the display-title
 * indexes UNIQUE, on a database upgraded from before they were made
 * non-unique) used to be taken as "already exists" and kept: two titles
 * sharing a display name then failed every write. createIndexSafely now
 * compares it with the code's definition and replaces it when it differs,
 * never leaving the collection without the index.
 */

jest.mock('@src/utils/sync/core/ResourceManager', () => ({
  ResourceManager: { getInstance: () => ({ dbWriteLimitFor: () => (fn) => fn() }) },
  getResourceManager: () => ({}),
}))
jest.mock('@src/lib/mongodb', () => ({ __esModule: true, default: Promise.resolve({}) }))

const isEqual = require('lodash/isEqual')
const { MovieRepository } = require('@src/utils/sync/infrastructure/database/MovieRepository')
const { TVShowRepository } = require('@src/utils/sync/infrastructure/database/TVShowRepository')
const { SeasonRepository } = require('@src/utils/sync/infrastructure/database/SeasonRepository')
const { EpisodeRepository } = require('@src/utils/sync/infrastructure/database/EpisodeRepository')
const {
  reconcileIndex,
  indexDifferences,
  sameIndexKey,
  defaultIndexName,
} = require('@src/utils/sync/infrastructure/database/indexReconcile')

const OPTIONS = ['unique', 'sparse', 'partialFilterExpression', 'expireAfterSeconds', 'collation']
const optionsOf = (index) => Object.fromEntries(OPTIONS.filter((o) => index[o] !== undefined && index[o] !== false).map((o) => [o, index[o]]))
const sameKey = (a, b) => isEqual(Object.entries(a), Object.entries(b))
const conflict = (code, message) => Object.assign(new Error(message), { code, codeName: code === 85 ? 'IndexOptionsConflict' : 'IndexKeySpecsConflict' })

/**
 * A collection's indexes with MongoDB's createIndex answers: the same name
 * with another key is 86, the same name or key with other options is 85, an
 * equivalent index under another name is 85 too, and a unique index over
 * duplicate values fails with E11000. `duplicates` names the unique indexes
 * the data cannot hold.
 */
function indexedCollection(initial = [], { duplicates = [], failRestore = false, loseDropReply: lose = false, dropError = 'lost', failCreateOf = null } = {}) {
  let loseDropReply = lose
  let indexes = [{ v: 2, key: { _id: 1 }, name: '_id_' }, ...initial.map((index) => ({ v: 2, ...index }))]
  let creates = 0
  const collection = {
    indexes: jest.fn(async () => structuredClone(indexes)),
    createIndex: jest.fn(async (key, options = {}) => {
      creates += 1
      const name = options.name ?? defaultIndexName(key)
      const wanted = { key, name, ...optionsOf(options) }
      const byName = indexes.find((index) => index.name === name)
      if (byName && !sameKey(byName.key, key)) throw conflict(86, `An existing index has the same name as the requested index: ${name}`)
      if (byName && !isEqual(optionsOf(byName), optionsOf(wanted))) throw conflict(85, `Index with name: ${name} already exists with different options`)
      if (byName) return name
      const byKey = indexes.find((index) => sameKey(index.key, key))
      if (byKey) throw conflict(85, `Index already exists with a different name: ${byKey.name}`)
      if (wanted.unique && duplicates.includes(name)) throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 })
      if (failRestore && creates > 1) throw new Error('not primary')
      if (name === failCreateOf) throw new Error('not primary')
      indexes.push({ v: 2, ...wanted })
      return name
    }),
    dropIndex: jest.fn(async (name) => {
      if (!indexes.some((index) => index.name === name)) {
        throw Object.assign(new Error(`index not found with name [${name}]`), { code: 27, codeName: 'IndexNotFound' })
      }
      indexes = indexes.filter((index) => index.name !== name)
      // The server dropped it; its answer does not arrive
      if (loseDropReply) {
        loseDropReply = false
        throw new Error(`connection 3 to db.example:27017 closed (${dropError})`)
      }
    }),
    named: (name) => indexes.find((index) => index.name === name),
  }
  return collection
}

const clientOver = (collections) => ({ db: () => ({ collection: (name) => collections[name] }) })

beforeEach(() => {
  delete globalThis.__syncIndexReconciles
  for (const method of ['info', 'warn', 'error', 'log']) jest.spyOn(console, method).mockImplementation(() => {})
})
afterEach(() => {
  jest.restoreAllMocks()
})

describe('an index whose options differ from the code’s', () => {
  it.each([
    ['FlatMovies', MovieRepository, { key: { title: 1 }, name: 'title_index', unique: true }],
    ['FlatTVShows', TVShowRepository, { key: { title: 1 }, name: 'title_index', unique: true }],
    ['FlatSeasons', SeasonRepository, { key: { showTitle: 1, seasonNumber: 1 }, name: 'showTitle_1_seasonNumber_1', unique: true }],
    [
      'FlatEpisodes',
      EpisodeRepository,
      { key: { showTitle: 1, seasonNumber: 1, episodeNumber: 1 }, name: 'showTitle_1_seasonNumber_1_episodeNumber_1', unique: true },
    ],
  ])('is replaced: %s’s stale UNIQUE display-title index becomes non-unique', async (name, Repository, stale) => {
    const collection = indexedCollection([stale])

    await expect(new Repository(clientOver({ [name]: collection })).createIndexes()).resolves.toBe(true)

    expect(collection.named(stale.name)).toEqual({ v: 2, key: stale.key, name: stale.name })
    expect(collection.dropIndex).toHaveBeenCalledTimes(1)
    const lines = console.info.mock.calls.map(([line]) => line)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(`[indexes] ${name}: replaced ${stale.name}`)
    expect(lines[0]).toContain('"unique":true')
    expect(lines[0]).toContain('(unique differed)')
  })

  it('is replaced when the name holds another key (IndexKeySpecsConflict, 86)', async () => {
    const collection = indexedCollection([{ key: { seasonId: 1 }, name: 'season_episode_index' }])

    const outcome = await reconcileIndex(collection, 'FlatEpisodes', { seasonId: 1, episodeNumber: 1 }, { name: 'season_episode_index' })

    expect(outcome).toBe('replaced')
    expect(collection.named('season_episode_index').key).toEqual({ seasonId: 1, episodeNumber: 1 })
  })

  it('is replaced when it is found by its key under another name', async () => {
    const collection = indexedCollection([{ key: { title: 1 }, name: 'title_1', unique: true }])

    await reconcileIndex(collection, 'FlatMovies', { title: 1 }, { name: 'title_index' })

    expect(collection.named('title_1')).toBeUndefined()
    expect(collection.named('title_index')).toEqual({ v: 2, key: { title: 1 }, name: 'title_index' })
  })
})

describe('an index that matches the code’s', () => {
  it('is left alone when it is the same index (createIndex is a no-op)', async () => {
    const collection = indexedCollection([{ key: { title: 1 }, name: 'title_index' }])

    await expect(new MovieRepository(clientOver({ FlatMovies: collection })).createIndexes()).resolves.toBe(true)

    expect(collection.dropIndex).not.toHaveBeenCalled()
    expect(collection.named('title_index')).toEqual({ v: 2, key: { title: 1 }, name: 'title_index' })
  })

  it('is left alone under another name: only the name differs', async () => {
    const collection = indexedCollection([{ key: { title: 1 }, name: 'title_1' }])

    const outcome = await reconcileIndex(collection, 'FlatMovies', { title: 1 }, { name: 'title_index' })

    expect(outcome).toBe('matches')
    expect(collection.dropIndex).not.toHaveBeenCalled()
    expect(console.info).not.toHaveBeenCalled()
  })
})

describe('a replacement that cannot be built', () => {
  // The direction a unique index takes: an older non-unique one, over data
  // with duplicates the unique one refuses
  const key = { showId: 1, seasonNumber: 1, episodeNumber: 1 }
  const options = { unique: true, partialFilterExpression: { showId: { $exists: true } } }
  const oldIndex = { key, name: 'showId_1_seasonNumber_1_episodeNumber_1' }

  it('restores the previous definition and logs an error, so the collection keeps its index', async () => {
    const collection = indexedCollection([oldIndex], { duplicates: ['showId_1_seasonNumber_1_episodeNumber_1'] })

    await expect(new EpisodeRepository(clientOver({ FlatEpisodes: collection })).createIndexes()).resolves.toBe(true)

    expect(collection.named(oldIndex.name)).toEqual({ v: 2, ...oldIndex })
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`[indexes] FlatEpisodes: could not create ${oldIndex.name}`))
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('E11000'))
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`restored ${oldIndex.name}`))
  })

  it('is attempted once per process, not on every sync', async () => {
    const collection = indexedCollection([oldIndex], { duplicates: [oldIndex.name] })

    expect(await reconcileIndex(collection, 'FlatEpisodes', key, options)).toBe('restored')
    expect(await reconcileIndex(collection, 'FlatEpisodes', key, options)).toBe('already-attempted')

    expect(collection.dropIndex).toHaveBeenCalledTimes(1)
    expect(collection.named(oldIndex.name)).toEqual({ v: 2, ...oldIndex })
  })

  it('throws when the previous definition cannot be restored either, so createIndexes reports the failure', async () => {
    const collection = indexedCollection([oldIndex], { duplicates: [oldIndex.name], failRestore: true })

    await expect(reconcileIndex(collection, 'FlatEpisodes', key, options)).rejects.toThrow('not primary')
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('the collection has neither'))
  })

  describe('a drop the server applied but whose answer was lost', () => {
    const stale = { key: { title: 1 }, name: 'title_index', unique: true }

    it('is taken as dropped when the retry finds no index (IndexNotFound), and the code’s index is created', async () => {
      const collection = indexedCollection([stale], { loseDropReply: true })

      await expect(new MovieRepository(clientOver({ FlatMovies: collection })).createIndexes()).resolves.toBe(true)

      expect(collection.dropIndex).toHaveBeenCalledTimes(2)
      expect(collection.named('title_index')).toEqual({ v: 2, key: { title: 1 }, name: 'title_index' })
      expect(console.info).toHaveBeenCalledWith(expect.stringContaining('[indexes] FlatMovies: replaced title_index'))
    })

    it('never reports success with neither index there: the code’s index is created', async () => {
      // No retry: the lost answer is the only answer, and the step reports the index kept
      const collection = indexedCollection([stale], { loseDropReply: true, dropError: 'not retried' })

      expect(await reconcileIndex(collection, 'FlatMovies', { title: 1 }, { name: 'title_index' })).toBe('created')

      expect(collection.named('title_index')).toEqual({ v: 2, key: { title: 1 }, name: 'title_index' })
      expect(console.info).toHaveBeenCalledWith(expect.stringContaining('neither it nor title_index was there'))
    })

    it('reports the failure when the code’s index cannot be created then either', async () => {
      const collection = indexedCollection([stale], { loseDropReply: true, failCreateOf: 'title_index' })

      await expect(reconcileIndex(collection, 'FlatMovies', { title: 1 }, { name: 'title_index' })).rejects.toThrow('not primary')
      expect(collection.indexes.mock.calls.length).toBe(2)
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('neither title_index nor title_index is there'))
    })

    it('makes the repository’s createIndexes report the failure', async () => {
      const collection = indexedCollection([stale], { loseDropReply: true, failCreateOf: 'title_index' })

      await expect(new MovieRepository(clientOver({ FlatMovies: collection })).createIndexes()).resolves.toBe(false)
      expect(collection.named('title_index')).toBeUndefined()
    })
  })

  it('keeps the index when it cannot be dropped', async () => {
    const collection = indexedCollection([{ key: { title: 1 }, name: 'title_index', unique: true }])
    collection.dropIndex.mockRejectedValue(new Error('not authorized'))

    expect(await reconcileIndex(collection, 'FlatMovies', { title: 1 }, { name: 'title_index' })).toBe('kept')
    expect(collection.named('title_index').unique).toBe(true)
  })

  it('leaves the indexes as they are when they cannot be read', async () => {
    const collection = indexedCollection([{ key: { title: 1 }, name: 'title_index', unique: true }])
    collection.indexes.mockRejectedValue(new Error('not authorized'))

    expect(await reconcileIndex(collection, 'FlatMovies', { title: 1 }, { name: 'title_index' })).toBe('unreadable')
    expect(collection.dropIndex).not.toHaveBeenCalled()
  })
})

describe('every repository’s createIndexes', () => {
  it.each([
    ['FlatMovies', MovieRepository],
    ['FlatTVShows', TVShowRepository],
    ['FlatSeasons', SeasonRepository],
    ['FlatEpisodes', EpisodeRepository],
  ])('compares each index that conflicts (%s)', async (name, Repository) => {
    // Every index conflicts, and none is found: each one is looked up once
    const collection = {
      createIndex: jest.fn(async () => {
        throw conflict(85, 'Index already exists with a different name')
      }),
      indexes: jest.fn(async () => []),
      dropIndex: jest.fn(),
    }

    await expect(new Repository(clientOver({ [name]: collection })).createIndexes()).resolves.toBe(true)

    expect(collection.createIndex.mock.calls.length).toBeGreaterThan(5)
    expect(collection.indexes).toHaveBeenCalledTimes(collection.createIndex.mock.calls.length)
    expect(collection.dropIndex).not.toHaveBeenCalled()
  })
})

describe('the comparison', () => {
  it('reads the key in order, with its directions', () => {
    expect(sameIndexKey({ key: { a: 1, b: 1 } }, { a: 1, b: 1 })).toBe(true)
    expect(sameIndexKey({ key: { b: 1, a: 1 } }, { a: 1, b: 1 })).toBe(false)
    expect(sameIndexKey({ key: { a: -1 } }, { a: 1 })).toBe(false)
  })

  it('reads a text index from its stored weights', () => {
    const stored = { key: { _fts: 'text', _ftsx: 1 }, weights: { 'metadata.description': 1, title: 1 } }
    expect(sameIndexKey(stored, { title: 'text', 'metadata.description': 'text' })).toBe(true)
    expect(sameIndexKey(stored, { title: 'text' })).toBe(false)
  })

  it('names each option that differs', () => {
    const stored = { key: { a: 1 }, unique: true, sparse: true, expireAfterSeconds: 60, collation: { locale: 'en', strength: 2 } }
    expect(indexDifferences(stored, { a: 1 }, {})).toEqual(['unique', 'sparse', 'expireAfterSeconds', 'collation'])
    expect(indexDifferences(stored, { a: 1 }, { unique: true, sparse: true, expireAfterSeconds: 60, collation: { locale: 'en' } })).toEqual([])
    expect(indexDifferences({ key: { a: 1 } }, { a: 1 }, { partialFilterExpression: { a: { $exists: true } } })).toEqual([
      'partialFilterExpression',
    ])
  })
})
