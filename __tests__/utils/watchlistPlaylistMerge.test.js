/**
 * Moving items into a playlist (moves, deleted playlists, merged default
 * playlists) must never leave it holding a title twice: the Watchlist
 * collection's unique_playlist_title index would reject the move part way.
 */

const { planPlaylistMerge, titleKey } = require('@src/utils/watchlist/playlistMerge')

const item = (_id, mediaType, tmdbId) => ({ _id, mediaType, tmdbId })

describe('titleKey', () => {
  it('tells a movie and a TV show with the same TMDB id apart', () => {
    expect(titleKey(item('a', 'movie', 920))).not.toBe(titleKey(item('b', 'tv', 920)))
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
})
