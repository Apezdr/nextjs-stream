/**
 * @jest-environment node
 *
 * The file server's title hashes (`syncHash`, `contentHash`) are no longer
 * written, and nothing reads them. The migration removes what is left of them
 * from every Flat* document, once per database, in bounded batches — and
 * touches nothing else: not the gates (no reprocess), not `syncRunId` or
 * `updatedAt` (post-sync cleanup decides deletes on them).
 */

const { dropTitleHashes, dropTitleHashesOnce, DROP_TITLE_HASHES_MIGRATION } = require('@src/utils/sync/run/dropTitleHashes')

// MongoDB stores a field set to `undefined` as `null`.
const stored = (value) => JSON.parse(JSON.stringify(value, (_key, v) => (v === undefined ? null : v)))

function matches(doc, filter) {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') return condition.some((branch) => matches(doc, branch))
    const value = doc[key]
    if (condition && typeof condition === 'object' && '$exists' in condition) return (key in doc) === condition.$exists
    if (condition && typeof condition === 'object' && '$in' in condition) return condition.$in.includes(value)
    return value === condition
  })
}

function memoryClient() {
  const dbs = {}
  const calls = []
  const collection = (dbName, name) => {
    dbs[dbName] ??= {}
    if (dbs[dbName][name]) return dbs[dbName][name]
    const c = {
      docs: [],
      find(filter, { projection } = {}) {
        let size = Infinity
        const cursor = {
          batchSize(n) {
            size = n
            return cursor
          },
          async *[Symbol.asyncIterator]() {
            calls.push({ op: 'find', collection: name, batchSize: size })
            for (const doc of c.docs.filter((d) => matches(d, filter))) {
              yield projection ? Object.fromEntries(Object.keys(projection).map((k) => [k, doc[k]])) : { ...doc }
            }
          },
        }
        return cursor
      },
      async updateMany(filter, update) {
        calls.push({ op: 'updateMany', collection: name, ids: filter._id.$in.length })
        let modifiedCount = 0
        for (const doc of c.docs.filter((d) => matches(d, filter))) {
          const keys = Object.keys(update.$unset).filter((k) => k in doc)
          for (const k of keys) delete doc[k]
          if (keys.length > 0) modifiedCount++
        }
        return { modifiedCount }
      },
      async findOne(filter) {
        return c.docs.find((d) => matches(d, filter)) ?? null
      },
      async updateOne(filter, update, { upsert } = {}) {
        let doc = c.docs.find((d) => matches(d, filter))
        if (!doc && upsert) c.docs.push((doc = { ...filter }))
        if (doc) Object.assign(doc, stored(update.$set))
      },
    }
    dbs[dbName][name] = c
    return c
  }
  return { client: { db: (dbName) => ({ collection: (name) => collection(dbName, name) }) }, collection, calls }
}

const RUN = 'run-7'
const UPDATED = '2026-10-01T00:00:00.000Z'
const flatDoc = (id, extra = {}) =>
  stored({ _id: id, title: `Title ${id}`, syncRunId: RUN, updatedAt: UPDATED, syncGates: { default: 'g1:aa#bb' }, ...extra })

function seed(mem) {
  mem.collection('Media', 'FlatMovies').docs.push(
    flatDoc('m1', { syncHash: 'h1' }),
    flatDoc('m2'),
    flatDoc('m3', { syncHash: null }) // a stamp of undefined, as MongoDB keeps it
  )
  mem.collection('Media', 'FlatTVShows').docs.push(flatDoc('s1', { syncHash: 'h2', contentHash: 'c2' }))
  mem.collection('Media', 'FlatSeasons').docs.push(flatDoc('se1', { syncHash: 'h3' }))
  mem.collection('Media', 'FlatEpisodes').docs.push(
    ...Array.from({ length: 1201 }, (_, i) => flatDoc(`e${i}`, i % 2 === 0 ? { syncHash: `h${i}` } : {}))
  )
}

beforeEach(() => {
  delete globalThis.__dataMigrations
})

describe('dropTitleHashes', () => {
  it('removes both fields from every Flat* document that has either, and nothing else', async () => {
    const mem = memoryClient()
    seed(mem)
    const before = (name) => mem.collection('Media', name).docs.map((d) => ({ ...d }))
    const episodesBefore = before('FlatEpisodes')

    const changed = await dropTitleHashes(mem.client.db('Media'))

    expect(changed).toEqual({ FlatMovies: 2, FlatTVShows: 1, FlatSeasons: 1, FlatEpisodes: 601 })
    for (const name of ['FlatMovies', 'FlatTVShows', 'FlatSeasons', 'FlatEpisodes']) {
      for (const doc of mem.collection('Media', name).docs) {
        expect(doc).not.toHaveProperty('syncHash')
        expect(doc).not.toHaveProperty('contentHash')
        // The gates, the run marker and the write time are as they were
        expect(doc).toMatchObject({ syncRunId: RUN, updatedAt: UPDATED, syncGates: { default: 'g1:aa#bb' } })
      }
    }
    const { syncHash: _h, ...firstEpisode } = episodesBefore[0]
    expect(mem.collection('Media', 'FlatEpisodes').docs[0]).toEqual(firstEpisode)
    expect(mem.collection('Media', 'FlatEpisodes').docs[1]).toEqual(episodesBefore[1])
  })

  it('works in batches of at most 500 documents', async () => {
    const mem = memoryClient()
    seed(mem)

    await dropTitleHashes(mem.client.db('Media'))

    const episodeBatches = mem.calls.filter((c) => c.op === 'updateMany' && c.collection === 'FlatEpisodes')
    expect(episodeBatches.map((c) => c.ids)).toEqual([500, 101])
    expect(mem.calls.filter((c) => c.op === 'find').every((c) => c.batchSize === 500)).toBe(true)
  })

  it('changes nothing the second time', async () => {
    const mem = memoryClient()
    seed(mem)
    await dropTitleHashes(mem.client.db('Media'))

    await expect(dropTitleHashes(mem.client.db('Media'))).resolves.toEqual({
      FlatMovies: 0,
      FlatTVShows: 0,
      FlatSeasons: 0,
      FlatEpisodes: 0,
    })
  })
})

describe('dropTitleHashesOnce', () => {
  it('applies once per database: the flag in app_config.migrations stops every later process', async () => {
    const mem = memoryClient()
    seed(mem)

    await expect(dropTitleHashesOnce(mem.client)).resolves.toMatchObject({ applied: true })
    const flag = mem.collection('app_config', 'migrations').docs.find((d) => d._id === DROP_TITLE_HASHES_MIGRATION)
    expect(flag).toMatchObject({ result: { FlatTVShows: 1 } })
    expect(flag.appliedAt).toEqual(expect.any(String))

    // A new process: it reads the flag and does nothing
    delete globalThis.__dataMigrations
    mem.collection('Media', 'FlatMovies').docs.push(flatDoc('m9', { syncHash: 'late' }))
    await expect(dropTitleHashesOnce(mem.client)).resolves.toEqual({ applied: false })
    expect(mem.collection('Media', 'FlatMovies').docs.find((d) => d._id === 'm9')).toHaveProperty('syncHash', 'late')
  })

  it('writes no flag when it fails, so the next run tries again', async () => {
    const mem = memoryClient()
    seed(mem)
    const episodes = mem.collection('Media', 'FlatEpisodes')
    const updateMany = episodes.updateMany
    episodes.updateMany = async () => {
      throw new Error('connection reset')
    }

    await expect(dropTitleHashesOnce(mem.client)).rejects.toThrow('connection reset')
    expect(mem.collection('app_config', 'migrations').docs).toEqual([])

    episodes.updateMany = updateMany
    await expect(dropTitleHashesOnce(mem.client)).resolves.toMatchObject({ applied: true })
    expect(episodes.docs.some((d) => 'syncHash' in d)).toBe(false)
  })

  it('runs once when two callers in one process start it together', async () => {
    const mem = memoryClient()
    seed(mem)

    const [a, b] = await Promise.all([dropTitleHashesOnce(mem.client), dropTitleHashesOnce(mem.client)])

    expect(a).toBe(b)
    expect(mem.calls.filter((c) => c.op === 'find' && c.collection === 'FlatMovies')).toHaveLength(1)
  })
})
