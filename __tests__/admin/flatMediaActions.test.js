const updateOne = jest.fn()
const insertOne = jest.fn()
const findOne = jest.fn()
const collection = jest.fn(() => ({ findOne, updateOne, insertOne }))

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

jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({
    db: () => ({ collection }),
  }),
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

import { createMovieAction, saveMovieAction } from '@src/utils/admin/flatMediaActions'

const existingMovie = {
  _id: 'movie-id',
  title: 'Movie',
  originalTitle: 'Movie Filesystem',
  videoURL: 'https://server/video.mp4',
  videoSource: 'server2',
  posterURL: 'https://server/poster.jpg',
  posterSource: 'server2',
  metadata: {
    overview: 'Same overview',
    genres: [{ id: 1, name: 'Drama' }],
  },
  metadataSource: 'server2',
  captionURLs: { en: { url: '/captions/en.vtt' } },
  captionSource: 'server2',
}

beforeEach(() => {
  findOne.mockReset().mockResolvedValue({ ...existingMovie })
  updateOne.mockReset().mockResolvedValue({ matchedCount: 1 })
  insertOne.mockReset().mockResolvedValue({ acknowledged: true })
  collection.mockClear()
})

describe('admin media provenance', () => {
  it('preserves server provenance for unchanged full-form values', async () => {
    await saveMovieAction(null, {
      id: 'movie-id',
      title: existingMovie.title,
      originalTitle: existingMovie.originalTitle,
      videoURL: existingMovie.videoURL,
      posterURL: existingMovie.posterURL,
      metadata: {
        overview: existingMovie.metadata.overview,
        genres: [{ id: 1, name: 'Drama' }],
      },
      captionURLs: { en: { url: '/captions/en.vtt' } },
    })

    const update = updateOne.mock.calls[0][1]
    expect(update.$unset).toBeUndefined()
    expect(update.$set).not.toHaveProperty('manualFields.videoURL')
    expect(update.$set).not.toHaveProperty('manualFields.posterURL')
    expect(update.$set).not.toHaveProperty('manualFields.metadata')
    expect(update.$set).not.toHaveProperty('manualFields.captionURLs')
  })

  it('clears only the changed field source and records manual ownership', async () => {
    await saveMovieAction(null, {
      id: 'movie-id',
      title: existingMovie.title,
      originalTitle: existingMovie.originalTitle,
      videoURL: existingMovie.videoURL,
      posterURL: 'https://manual/poster.jpg',
    })

    const update = updateOne.mock.calls[0][1]
    expect(update.$set['manualFields.posterURL']).toBe(true)
    expect(update.$unset.posterSource).toBe('')
    expect(update.$unset).not.toHaveProperty('videoSource')
  })

  it('migrates a legacy manual source sentinel on the next save', async () => {
    findOne.mockResolvedValue({
      ...existingMovie,
      posterSource: 'manual',
    })

    await saveMovieAction(null, {
      id: 'movie-id',
      title: existingMovie.title,
    })

    const update = updateOne.mock.calls[0][1]
    expect(update.$set['manualFields.posterURL']).toBe(true)
    expect(update.$unset.posterSource).toBe('')
  })

  it('clears normalizedVideoId when a manual video URL is removed', async () => {
    await saveMovieAction(null, {
      id: 'movie-id',
      videoURL: '',
    })

    const update = updateOne.mock.calls[0][1]
    expect(update.$unset).toMatchObject({
      videoURL: '',
      videoSource: '',
      normalizedVideoId: '',
      'manualFields.videoURL': '',
    })
  })

  it('rejects removal of the filesystem identity', async () => {
    const result = await saveMovieAction(null, {
      id: 'movie-id',
      originalTitle: '',
    })

    expect(result).toMatchObject({ status: 'error' })
    expect(updateOne).not.toHaveBeenCalled()
  })

  it('materializes dotted ownership and metadata paths on create', async () => {
    findOne.mockResolvedValue(null)

    await createMovieAction(null, {
      title: 'New Movie',
      originalTitle: 'New Movie Filesystem',
      videoURL: 'https://manual/video.mp4',
      metadata: { overview: 'Overview' },
    })

    const inserted = insertOne.mock.calls[0][0]
    expect(inserted).toMatchObject({
      metadata: { overview: 'Overview' },
      manualFields: {
        title: true,
        originalTitle: true,
        videoURL: true,
        metadata: true,
      },
    })
    expect(Object.keys(inserted).some((key) => key.includes('.'))).toBe(false)
  })
})
