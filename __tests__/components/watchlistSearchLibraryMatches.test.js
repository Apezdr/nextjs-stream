/**
 * The watchlist search lists library titles apart from TMDB-only ones. Which
 * TMDB results the library holds now comes from the server per TMDB id
 * (fetchLibraryMatches), not from the first page of the library search, and
 * titles are told apart by type and id: TMDB ids repeat across movies and TV.
 */

import {
  fetchLibraryMatches,
  notInPlaylist,
  splitTmdbResults,
  titleKey,
} from '@src/components/Watchlist/searchLibraryMatches'

const movie = (id, title, extra = {}) => ({ id, title, media_type: 'movie', release_date: '1999-03-31', ...extra })
const show = (id, name, extra = {}) => ({ id, name, media_type: 'tv', first_air_date: '2008-01-20', ...extra })

describe('fetchLibraryMatches', () => {
  afterEach(() => jest.restoreAllMocks())

  it('asks once for each distinct title and maps the answer by type and id', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ items: [{ tmdbId: 603, mediaType: 'movie', id: 'm1', title: 'The Matrix', posterURL: 'p' }] }),
    }))

    const matches = await fetchLibraryMatches([movie(603, 'The Matrix'), movie(603, 'The Matrix'), show(603, 'Other')])

    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
      items: [{ tmdbId: 603, mediaType: 'movie' }, { tmdbId: 603, mediaType: 'tv' }],
    })
    expect([...matches.keys()]).toEqual(['movie-603'])
  })

  it("doesn't ask about nothing", async () => {
    global.fetch = jest.fn()
    expect((await fetchLibraryMatches([])).size).toBe(0)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('fails loudly rather than offer library titles as TMDB-only', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500 }))
    await expect(fetchLibraryMatches([movie(1, 'A')])).rejects.toThrow('Library lookup failed: HTTP 500')
  })
})

describe('splitTmdbResults', () => {
  const libraryMatches = new Map([[titleKey('movie', 603), { id: 'm1', title: 'The Matrix', posterURL: 'https://files.example/matrix.jpg' }]])

  it('lists a library title as library media and the rest as TMDB-only', () => {
    const shownKeys = new Set()
    const { internal, external } = splitTmdbResults({
      tmdbResults: [movie(603, 'The Matrix', { overview: 'Neo' }), movie(604, 'The Matrix Reloaded'), show(603, 'Not the film')],
      libraryMatches,
      keep: () => true,
      shownKeys,
    })

    expect(internal).toEqual([
      {
        id: 603,
        title: 'The Matrix',
        media_type: 'movie',
        poster_path: 'https://files.example/matrix.jpg',
        release_date: '1999-03-31',
        first_air_date: null,
        overview: 'Neo',
        isInternalMedia: true,
        internalMediaId: 'm1',
      },
    ])
    // The show shares the film's TMDB id but is a different title, not in the library
    expect(external.map((item) => titleKey(item.media_type, item.id))).toEqual(['movie-604', 'tv-603'])
    expect([...shownKeys]).toEqual(['movie-603', 'movie-604', 'tv-603'])
  })

  it('skips titles already listed, so later pages never repeat one', () => {
    const shownKeys = new Set(['movie-603', 'movie-604'])
    const { internal, external } = splitTmdbResults({
      tmdbResults: [movie(603, 'The Matrix'), movie(604, 'Reloaded'), movie(605, 'Revolutions')],
      libraryMatches,
      keep: () => true,
      shownKeys,
    })

    expect(internal).toEqual([])
    expect(external.map((item) => item.id)).toEqual([605])
  })

  it('leaves out titles the playlist holds', () => {
    const keep = notInPlaylist([
      { tmdbId: 603, mediaType: 'movie', title: 'The Matrix' },
      { mediaType: 'tv', title: 'Breaking Bad' },
    ])
    const { internal, external } = splitTmdbResults({
      tmdbResults: [movie(603, 'The Matrix'), show(1396, 'Breaking Bad'), show(603, 'Kept')],
      libraryMatches,
      keep,
      shownKeys: new Set(),
    })

    expect(internal).toEqual([])
    expect(external.map((item) => item.name)).toEqual(['Kept'])
  })
})

describe('notInPlaylist', () => {
  const keep = notInPlaylist([{ tmdbId: 7, mediaType: 'movie', mediaId: 'm7', title: 'Seven' }])

  it('matches the playlist by type and TMDB id, library id, or title and type', () => {
    expect(keep({ key: 'movie-7', title: 'x', mediaType: 'movie' })).toBe(false)
    expect(keep({ key: 'tv-7', title: 'x', mediaType: 'tv' })).toBe(true)
    expect(keep({ key: 'movie-8', mediaId: 'm7', title: 'x', mediaType: 'movie' })).toBe(false)
    expect(keep({ key: 'movie-9', title: 'SEVEN', mediaType: 'movie' })).toBe(false)
    expect(keep({ key: 'tv-9', title: 'Seven', mediaType: 'tv' })).toBe(true)
  })
})
