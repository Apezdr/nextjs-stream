/**
 * @jest-environment node
 *
 * Admin media Server Actions (src/utils/admin/flatMediaActions.js).
 *
 * - A create inserts a document, so the update-style dot-paths the actions
 *   build (`metadata.id`, `manualFields.posterURL`) must become nested objects;
 *   `insertOne` would store them as literal dotted field names.
 * - The editors post the whole form, so a save must flag only the values that
 *   changed. A flag on an untouched server value stops FieldAbsenceCleaner from
 *   removing it once the server drops it.
 */

const mockCollections = {}
function mockCollection(name) {
  if (!mockCollections[name]) {
    mockCollections[name] = {
      findOne: jest.fn().mockResolvedValue(null),
      insertOne: jest.fn().mockResolvedValue({ acknowledged: true }),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
      updateMany: jest.fn().mockResolvedValue({ matchedCount: 0 }),
    }
  }
  return mockCollections[name]
}

jest.mock('mongodb', () => {
  class ObjectId {
    constructor(value) {
      this.value = value
    }

    static isValid(value) {
      return Boolean(value)
    }

    toString() {
      return String(this.value)
    }
  }
  return { ObjectId }
})

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))

jest.mock('@src/utils/routeAuth', () => ({
  isAdmin: jest.fn().mockResolvedValue({ email: 'admin@example.com' }),
}))

jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({ db: () => ({ collection: (name) => mockCollection(name) }) }),
}))

jest.mock('@src/utils/flatDatabaseUtils', () => ({
  generateNormalizedVideoId: jest.fn((value) => `normalized:${value}`),
}))

jest.mock('@src/utils/cache/invalidation', () => ({
  invalidateMovieDetailsCache: jest.fn().mockResolvedValue(undefined),
  invalidateTVShowDetailsCache: jest.fn().mockResolvedValue(undefined),
  invalidateSeasonDetailsCache: jest.fn().mockResolvedValue(undefined),
  invalidateEpisodeDetailsCache: jest.fn().mockResolvedValue(undefined),
}))

import {
  createMovieAction,
  createTVShowAction,
  saveMovieAction,
  saveTVShowAction,
  saveSeasonAction,
  saveEpisodeAction,
} from '@src/utils/admin/flatMediaActions'

const show = { _id: 'show-id', title: 'Show', originalTitle: 'Show (2020)' }

function insertedDoc(collectionName) {
  const { insertOne } = mockCollection(collectionName)
  expect(insertOne).toHaveBeenCalledTimes(1)
  return insertOne.mock.calls[0][0]
}

function updateOf(collectionName) {
  const { updateOne } = mockCollection(collectionName)
  expect(updateOne).toHaveBeenCalledTimes(1)
  return updateOne.mock.calls[0][1]
}

function manualFlagsIn(set) {
  return Object.keys(set).filter((key) => key.startsWith('manualFields.'))
}

function dottedKeysIn(doc) {
  return Object.keys(doc).filter((key) => key.includes('.'))
}

beforeEach(() => {
  for (const name of Object.keys(mockCollections)) delete mockCollections[name]
})

describe('creating a title stores nested fields, not dotted names', () => {
  it('createMovieAction nests metadata and manualFields', async () => {
    const result = await createMovieAction(null, {
      title: 'Heat',
      videoURL: 'https://server/heat.mp4',
      posterURL: 'https://server/heat.jpg',
      metadata: { id: 949, overview: 'A heist.' },
    })

    expect(result.status).toBe('success')
    const doc = insertedDoc('FlatMovies')
    expect(dottedKeysIn(doc)).toEqual([])
    expect(doc.metadata).toEqual({ id: 949, overview: 'A heist.' })
    expect(doc.manualFields).toEqual({ videoURL: true, posterURL: true, metadata: true })
  })

  it('createTVShowAction nests metadata and manualFields', async () => {
    await createTVShowAction(null, {
      title: 'Show',
      posterURL: 'https://server/show.jpg',
      metadata: { id: 1399 },
    })

    const doc = insertedDoc('FlatTVShows')
    expect(dottedKeysIn(doc)).toEqual([])
    expect(doc.metadata).toEqual({ id: 1399 })
    expect(doc.manualFields).toEqual({ posterURL: true, metadata: true })
  })

  it('saveSeasonAction nests them when it creates the season', async () => {
    mockCollection('FlatTVShows').findOne.mockResolvedValue(show)

    await saveSeasonAction(null, {
      showId: 'show-id',
      seasonNumber: '1',
      posterURL: 'https://server/s1.jpg',
      metadata: { overview: 'Season one.' },
    })

    const doc = insertedDoc('FlatSeasons')
    expect(dottedKeysIn(doc)).toEqual([])
    expect(doc.metadata).toEqual({ overview: 'Season one.' })
    expect(doc.manualFields).toEqual({ posterURL: true, metadata: true })
  })

  it('saveEpisodeAction nests them when it creates the episode', async () => {
    mockCollection('FlatTVShows').findOne.mockResolvedValue(show)
    mockCollection('FlatSeasons').findOne.mockResolvedValue({ _id: 'season-id' })

    await saveEpisodeAction(null, {
      showId: 'show-id',
      seasonNumber: '1',
      episodeNumber: '2',
      thumbnail: 'https://server/e2.jpg',
      metadata: { air_date: '2020-01-08' },
    })

    const doc = insertedDoc('FlatEpisodes')
    expect(dottedKeysIn(doc)).toEqual([])
    expect(doc.metadata).toEqual({ air_date: '2020-01-08' })
    expect(doc.manualFields).toEqual({ thumbnail: true, metadata: true })
  })
})

describe('saving flags only the values that changed', () => {
  const existingMovie = {
    _id: 'movie-id',
    title: 'Heat',
    originalTitle: 'Heat (1995)',
    videoURL: 'https://server/heat.mp4',
    posterURL: 'https://server/heat.jpg',
    metadata: { overview: 'A heist.', genres: [{ id: 80, name: 'Crime' }] },
  }

  beforeEach(() => {
    mockCollection('FlatMovies').findOne.mockResolvedValue({ ...existingMovie })
  })

  it('flags nothing when the whole form is posted back unchanged', async () => {
    await saveMovieAction(null, {
      id: 'movie-id',
      title: existingMovie.title,
      originalTitle: existingMovie.originalTitle,
      videoURL: existingMovie.videoURL,
      posterURL: existingMovie.posterURL,
      metadata: { overview: 'A heist.', genres: [{ id: 80, name: 'Crime' }] },
    })

    const { $set } = updateOf('FlatMovies')
    expect(manualFlagsIn($set)).toEqual([])
    expect($set.posterURL).toBe(existingMovie.posterURL)
  })

  it('flags only the field and the metadata that changed', async () => {
    await saveMovieAction(null, {
      id: 'movie-id',
      videoURL: existingMovie.videoURL,
      posterURL: 'https://server/heat-new.jpg',
      metadata: { overview: 'A different heist.', genres: [{ id: 80, name: 'Crime' }] },
    })

    const { $set } = updateOf('FlatMovies')
    expect(manualFlagsIn($set).sort()).toEqual(['manualFields.metadata', 'manualFields.posterURL'])
  })

  it('still clears the flag when a field is emptied', async () => {
    await saveMovieAction(null, { id: 'movie-id', posterURL: '' })

    const { $unset } = updateOf('FlatMovies')
    expect($unset).toEqual(
      expect.objectContaining({ posterURL: '', 'manualFields.posterURL': '' })
    )
  })

  it('leaves an unchanged episode thumbnail unflagged, so the cleaner can still remove it', async () => {
    mockCollection('FlatTVShows').findOne.mockResolvedValue(show)
    mockCollection('FlatSeasons').findOne.mockResolvedValue({ _id: 'season-id' })
    mockCollection('FlatEpisodes').findOne.mockResolvedValue({
      _id: 'episode-id',
      videoURL: 'https://server/e2.mp4',
      thumbnail: 'https://server/e2.jpg',
    })

    await saveEpisodeAction(null, {
      showId: 'show-id',
      seasonNumber: '1',
      episodeNumber: '2',
      episodeId: 'episode-id',
      videoURL: 'https://server/e2.mp4',
      thumbnail: 'https://server/e2.jpg',
    })

    const { $set } = updateOf('FlatEpisodes')
    expect(manualFlagsIn($set)).toEqual([])
  })
})

// The editors lock the display title when the admin changes it (useFieldLocks),
// since the sync rewrites an unlocked one. A save stores the locks the form
// sends, as they are, and reopens the sync's gates.
describe.each([
  ['saveMovieAction', saveMovieAction, 'FlatMovies'],
  ['saveTVShowAction', saveTVShowAction, 'FlatTVShows'],
])('%s and the title lock', (_name, save, collection) => {
  const existing = {
    _id: 'doc-id',
    title: 'Old Title',
    originalTitle: 'Old Title (2001)',
    lockedFields: { posterURL: true },
    syncGates: { A: 'gate' },
  }

  it('stores the title locked when the form sends it locked', async () => {
    mockCollection(collection).findOne.mockResolvedValue({ ...existing })

    const result = await save(null, { id: 'doc-id', title: 'New Title', lockedFields: { posterURL: true, title: true } })

    expect(result.status).toBe('success')
    const { $set, $unset } = updateOf(collection)
    expect($set.title).toBe('New Title')
    expect($set.lockedFields).toEqual({ posterURL: true, title: true })
    expect($unset).toEqual(expect.objectContaining({ syncGates: '' }))
  })

  it('stores it unlocked when the admin turned the lock off before saving', async () => {
    mockCollection(collection).findOne.mockResolvedValue({ ...existing, lockedFields: { title: true } })

    await save(null, { id: 'doc-id', title: 'New Title', lockedFields: {} })

    const { $set, $unset } = updateOf(collection)
    expect($set.title).toBe('New Title')
    expect($set).not.toHaveProperty('lockedFields')
    expect($unset).toEqual(expect.objectContaining({ lockedFields: '', syncGates: '' }))
  })

  it.each([[''], ['   '], [null]])('refuses to clear the title (%j), as create does', async (title) => {
    mockCollection(collection).findOne.mockResolvedValue({ ...existing })

    const result = await save(null, { id: 'doc-id', title, lockedFields: { title: true } })

    expect(result).toEqual({ status: 'error', message: 'Title is required.' })
    expect(mockCollection(collection).updateOne).not.toHaveBeenCalled()
  })

  it('leaves the locks as they were when the title is unchanged', async () => {
    mockCollection(collection).findOne.mockResolvedValue({ ...existing })

    await save(null, { id: 'doc-id', title: 'Old Title', lockedFields: { posterURL: true } })

    const { $set, $unset } = updateOf(collection)
    expect($set.lockedFields).toEqual({ posterURL: true })
    expect($unset).toEqual({ syncGates: '' })
  })
})
