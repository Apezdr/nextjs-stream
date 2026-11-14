/**
 * Moving items into a playlist (moves, deleted playlists, merged default
 * playlists) must never leave it holding a title twice: the Watchlist
 * collection's unique_playlist_title index would reject the move part way.
 */

const { hasTitleIdentity, isLibraryMediaId, planPlaylistMerge, titleKey } = require('@src/utils/watchlist/playlistMerge')

const item = (_id, mediaType, tmdbId) => ({ _id, mediaType, tmdbId })
// A library title with no TMDB id, kept under the library's own id for it
const SINTEL = 'mid:e31a15704f374ca9'
const BUNNY = 'mid:79b5f61dd251e37d'
const libraryItem = (_id, mediaType, libraryMediaId) => ({ _id, mediaType, libraryMediaId })

describe('titleKey', () => {
  it('tells a movie and a TV show with the same TMDB id apart', () => {
    expect(titleKey(item('a', 'movie', 920))).not.toBe(titleKey(item('b', 'tv', 920)))
  })

  it('keys a title with no TMDB id on its library id, apart from every TMDB number', () => {
    expect(titleKey(libraryItem('a', 'movie', SINTEL))).toBe(`movie:${SINTEL}`)
    expect(titleKey(libraryItem('a', 'movie', SINTEL))).not.toBe(titleKey(libraryItem('b', 'tv', SINTEL)))
    expect(titleKey(libraryItem('a', 'movie', SINTEL))).not.toBe(titleKey(libraryItem('b', 'movie', BUNNY)))
  })

  it('keeps the TMDB id as the key of an item that carries both', () => {
    // What a resolved library title looks like once it has been given a TMDB id
    expect(titleKey({ mediaType: 'movie', tmdbId: 45745, libraryMediaId: SINTEL })).toBe('movie:45745')
  })

  it('keys a numeric string the same as the number', () => {
    expect(titleKey(item('a', 'movie', '920'))).toBe(titleKey(item('b', 'movie', 920)))
  })
})

describe('a title’s identity', () => {
  it('is a library id only in the form the media processor writes', () => {
    expect(isLibraryMediaId(SINTEL)).toBe(true)
    // Not a catalog document's _id, which changes when a title leaves and comes back
    expect(isLibraryMediaId('6a4fa5575bd6dc41316ddacd')).toBe(false)
    expect(isLibraryMediaId('mid:')).toBe(false)
    expect(isLibraryMediaId(undefined)).toBe(false)
    expect(isLibraryMediaId(45745)).toBe(false)
  })

  it('is a TMDB id or a library id; an item with neither has none', () => {
    expect(hasTitleIdentity(item('a', 'movie', 920))).toBe(true)
    expect(hasTitleIdentity(libraryItem('a', 'movie', SINTEL))).toBe(true)
    expect(hasTitleIdentity(item('a', 'movie', undefined))).toBe(false)
    expect(hasTitleIdentity(libraryItem('a', 'movie', 'not-an-id'))).toBe(false)
  })
})

describe('planPlaylistMerge', () => {
  it('drops a title the target already holds and moves the rest', () => {
    const plan = planPlaylistMerge(
      [item('cars', 'movie', 920), item('severance', 'tv', 95396)],
      [item('existing', 'movie', 920)]
    )
    expect(plan).toEqual({ moveIds: ['severance'], dropIds: ['cars'] })
  })

  it('keeps only the first of a title repeated among the items being moved', () => {
    // Two duplicate default playlists both holding Cars, merged into a keeper that doesn't
    const plan = planPlaylistMerge([item('first', 'movie', 920), item('second', 'movie', 920)], [])
    expect(plan).toEqual({ moveIds: ['first'], dropIds: ['second'] })
  })

  it('does not treat the same TMDB id under another media type as the same title', () => {
    const plan = planPlaylistMerge([item('show', 'tv', 920)], [item('film', 'movie', 920)])
    expect(plan).toEqual({ moveIds: ['show'], dropIds: [] })
  })

  it('always moves items without a TMDB id, which the unique index leaves out', () => {
    const plan = planPlaylistMerge(
      [item('legacy1', 'movie', undefined), item('legacy2', 'movie', undefined)],
      [item('legacy0', 'movie', undefined)]
    )
    expect(plan).toEqual({ moveIds: ['legacy1', 'legacy2'], dropIds: [] })
  })

  it('drops a library-keyed title the target already holds: unique_playlist_library_title would reject it', () => {
    const plan = planPlaylistMerge(
      [libraryItem('sintel', 'movie', SINTEL), libraryItem('bunny', 'movie', BUNNY), libraryItem('bunny-again', 'movie', BUNNY)],
      [libraryItem('existing', 'movie', SINTEL)]
    )
    expect(plan).toEqual({ moveIds: ['bunny'], dropIds: ['sintel', 'bunny-again'] })
  })

  it('does not treat a library-keyed title and a TMDB-keyed one as the same', () => {
    const plan = planPlaylistMerge([libraryItem('sintel', 'movie', SINTEL)], [item('film', 'movie', 45745)])
    expect(plan).toEqual({ moveIds: ['sintel'], dropIds: [] })
  })
})
