/**
 * @jest-environment node
 *
 * A server's library credits (run/libraryCredits, CREDITS_SIDECAR.md Library
 * scope): the library-root credits file its manifests publish, stored per
 * server, fetched through the prefetch step, kept on failure, removed only on
 * the server's own confirmed absence.
 */

const { createHash } = require('crypto')

jest.mock('@src/utils/sync/core/ResourceManager', () => ({
  ResourceManager: { getInstance: () => ({ throttleHttp: (fn) => fn() }) },
  getResourceManager: () => ({}),
}))
jest.mock('@src/lib/httpHelper', () => ({ httpGet: jest.fn() }))
jest.mock('@src/utils/config', () => ({ getServer: (id) => ({ id, priority: 1 }) }))
jest.mock('@src/utils/sync/infrastructure/fileSystem/fetchFile', () => ({ fetchMetadataMultiServer: jest.fn() }))

const { fetchMetadataMultiServer } = require('@src/utils/sync/infrastructure/fileSystem/fetchFile')
const { syncLibraryCredits, libraryCreditsLocator } = require('@src/utils/sync/run/libraryCredits')
const { resolveLibraryCredits } = require('@src/utils/credits/resolve')

const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex')
const NOW = new Date('2026-10-29T00:00:00.000Z')

/** The library file the demo proposes: three contributing posters, each credited on its own. */
const collage = () => ({
  schemaVersion: 1,
  assets: [
    {
      id: 'poster-collage',
      kind: 'artwork',
      path: 'poster_collage.jpg',
      label: 'Poster collage',
      derivedFrom: [
        { libraryPath: 'movies/Short Film A/poster.jpg' },
        { libraryPath: 'movies/Short Film B/poster.jpg' },
        { libraryPath: 'movies/Short Film C/poster.jpg' },
      ],
    },
  ],
  entries: [
    { id: 'collage-film-a', assetIds: ['poster-collage'], work: 'Short Film A poster', license: 'CC BY 3.0' },
    { id: 'collage-film-b', assetIds: ['poster-collage'], work: 'Short Film B poster', license: 'CC BY 3.0' },
    { id: 'collage-film-c', assetIds: ['poster-collage'], work: 'Short Film C poster', license: 'CC BY 4.0', exclusions: ['<logos>'] },
  ],
})
const TEXT = JSON.stringify(collage())
const HASH = sha(TEXT)
const present = (hash = HASH) => ({ url: `/credits.json?hash=${hash}`, hash })
const manifestsWith = (credits) => ({ movies: { library: { credits } }, tv: { library: { credits } } })

/** An in-memory LibraryCredits collection. */
function collectionOver(docs = {}) {
  return {
    docs,
    findOne: jest.fn(async ({ _id }) => (docs[_id] ? structuredClone(docs[_id]) : null)),
    updateOne: jest.fn(async ({ _id }, update) => {
      const doc = { ...(docs[_id] ?? { _id }), ...update.$set }
      for (const field of Object.keys(update.$unset ?? {})) delete doc[field]
      docs[_id] = doc
    }),
    deleteOne: jest.fn(async ({ _id }) => {
      delete docs[_id]
    }),
  }
}
const run = (collection, manifests) =>
  syncLibraryCredits({ collection, serverConfig: { id: 'A', priority: 1 }, manifests, syncRunId: 'run-1', now: NOW })

beforeEach(() => {
  jest.clearAllMocks()
  fetchMetadataMultiServer.mockImplementation(async (_server, path, type) => (type === 'text' && path === `/credits.json?hash=${HASH}` ? TEXT : null))
})

it('stores a server\'s library file, stamped with the run', async () => {
  const collection = collectionOver()
  const result = await run(collection, manifestsWith(present()))
  expect(result).toMatchObject({ action: 'stored', retry: false })
  expect(fetchMetadataMultiServer).toHaveBeenCalledWith('A', `/credits.json?hash=${HASH}`, 'text', 'library', 'library of A')
  expect(collection.docs.A).toEqual({ _id: 'A', credits: collage(), creditsSource: 'A', creditsHash: HASH, serverId: 'A', lastSynced: NOW, syncRunId: 'run-1' })
})

it('keeps every contributing poster\'s own credit when shown', async () => {
  const collection = collectionOver()
  await run(collection, manifestsWith(present()))
  const shown = resolveLibraryCredits([collection.docs.A])
  expect(shown.entries.map((entry) => [entry.scope, entry.work, entry.license])).toEqual([
    ['library', 'Short Film A poster', 'CC BY 3.0'],
    ['library', 'Short Film B poster', 'CC BY 3.0'],
    ['library', 'Short Film C poster', 'CC BY 4.0'],
  ])
  expect(shown.entries[2].exclusions).toEqual(['<logos>'])
})

it('fetches nothing and writes nothing while the stored file is the published one', async () => {
  const collection = collectionOver({ A: { _id: 'A', credits: collage(), creditsSource: 'A', creditsHash: HASH } })
  expect(await run(collection, manifestsWith(present()))).toMatchObject({ action: 'unchanged', retry: false })
  expect(fetchMetadataMultiServer).not.toHaveBeenCalled()
  expect(collection.updateOne).not.toHaveBeenCalled()
})

it('keeps the last valid credits and asks for a retry when the fetch fails', async () => {
  const collection = collectionOver({ A: { _id: 'A', credits: collage(), creditsSource: 'A', creditsHash: 'old' } })
  const result = await run(collection, manifestsWith(present('c'.repeat(64))))
  expect(result).toMatchObject({ action: 'failed', retry: true })
  expect(collection.docs.A.credits).toEqual(collage())
  expect(collection.docs.A.creditsStatus).toMatchObject({ reason: 'fetch-failed', serverId: 'A' })
})

it('records a file it cannot use without asking for a retry', async () => {
  const bad = JSON.stringify({ ...collage(), suppress: ['x'] })
  fetchMetadataMultiServer.mockResolvedValue(bad)
  const collection = collectionOver()
  expect(await run(collection, manifestsWith(present(sha(bad))))).toMatchObject({ action: 'rejected', retry: false })
  expect(collection.docs.A.creditsStatus).toMatchObject({ reason: 'schema' })
  expect(collection.docs.A).not.toHaveProperty('credits')
})

it('removes the credits on the server\'s confirmed absence', async () => {
  const collection = collectionOver({ A: { _id: 'A', credits: collage(), creditsSource: 'A', creditsHash: HASH } })
  expect(await run(collection, manifestsWith({ absent: true }))).toMatchObject({ action: 'removed' })
  expect(collection.docs).toEqual({})
})

it('keeps the credits when the processor reports an error or publishes no library value', async () => {
  const stored = { A: { _id: 'A', credits: collage(), creditsSource: 'A', creditsHash: HASH } }
  const errored = collectionOver(structuredClone(stored))
  expect(await run(errored, manifestsWith({ error: 'unreadable' }))).toMatchObject({ action: 'failed', retry: true })
  expect(errored.docs.A.credits).toEqual(collage())

  const older = collectionOver(structuredClone(stored))
  expect(await run(older, { movies: { titles: new Map() }, tv: { titles: new Map() } })).toMatchObject({ action: 'unchanged', retry: false })
  expect(older.deleteOne).not.toHaveBeenCalled()
  expect(older.docs.A.credits).toEqual(collage())
})

it('leaves a recorded failure alone when the processor publishes no library value', async () => {
  const status = { state: 'error', reason: 'fetch-failed', serverId: 'A', since: NOW }
  const collection = collectionOver({ A: { _id: 'A', credits: collage(), creditsSource: 'A', creditsHash: 'old', creditsStatus: status } })
  expect(await run(collection, { movies: { titles: new Map() }, tv: { titles: new Map() } })).toMatchObject({ action: 'unchanged', retry: false })
  expect(collection.findOne).not.toHaveBeenCalled()
  expect(collection.updateOne).not.toHaveBeenCalled()
  expect(collection.docs.A.creditsStatus).toEqual(status)
})

describe('libraryCreditsLocator', () => {
  it('reads the movies manifest, else the TV one, else nothing', () => {
    expect(libraryCreditsLocator({ movies: { library: { credits: { absent: true } } }, tv: { library: { credits: present() } } })).toEqual({ absent: true })
    expect(libraryCreditsLocator({ movies: {}, tv: { library: { credits: present() } } })).toEqual(present())
    expect(libraryCreditsLocator({ movies: {}, tv: {} })).toBeUndefined()
    expect(libraryCreditsLocator(undefined)).toBeUndefined()
  })
})

describe('resolveLibraryCredits', () => {
  it('shows a file two servers share once, in the order given', () => {
    const other = { ...collage(), entries: [{ id: 'other', assetIds: ['poster-collage'], work: 'Other' }] }
    const shown = resolveLibraryCredits([
      { credits: collage(), creditsHash: HASH },
      { credits: collage(), creditsHash: HASH },
      { credits: other, creditsHash: 'h2' },
    ])
    expect(shown.entries.map((entry) => entry.id)).toEqual(['collage-film-a', 'collage-film-b', 'collage-film-c', 'other'])
    expect(resolveLibraryCredits([])).toBeNull()
  })
})

describe('the manifest', () => {
  const { parseManifest } = require('@src/utils/sync/run/manifestSource')
  const bytes = (body) => Buffer.from(JSON.stringify({ format: 2, kind: 'movies', version: 1, titles: {}, ...body }))

  it('carries the library value through, and none from a processor that predates it', () => {
    expect(parseManifest(bytes({ library: { credits: present() } }), 'movies', 'W/"1"').library).toEqual({ credits: present() })
    expect(parseManifest(bytes({}), 'movies', 'W/"1"').library).toBeUndefined()
  })
})
