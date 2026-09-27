/**
 * Custom-order moves in the watchlist, by drag on desktop or the Up/Down
 * actions on touch. They are id-based because the grid shows a filtered list
 * while the saved order covers the whole playlist.
 */

const { moveItemToPosition } = require('@src/components/Watchlist/reorder')

const ids = (items) => items.map((item) => item.id)
const list = (...names) => names.map((id) => ({ id, mediaType: id.startsWith('tv') ? 'tv' : 'movie' }))

describe('moveItemToPosition', () => {
  it('moving down lands the item where the target was, after it', () => {
    expect(ids(moveItemToPosition(list('a', 'b', 'c', 'd'), 'a', 'c'))).toEqual(['b', 'c', 'a', 'd'])
  })

  it('moving up lands the item where the target was, before it', () => {
    expect(ids(moveItemToPosition(list('a', 'b', 'c', 'd'), 'd', 'b'))).toEqual(['a', 'd', 'b', 'c'])
  })

  it('in a filtered view, moves the item the user dragged and leaves hidden items in order', () => {
    const playlist = list('m1', 'tv1', 'm2', 'tv2', 'm3')
    // Movies filter shows [m1, m2, m3]; m1 is dropped on m3. Taken as indices
    // (0 -> 2) into the full list, this used to put m1 before m3 instead of
    // after it: [m2, m1, m3].
    const next = moveItemToPosition(playlist, 'm1', 'm3')

    expect(ids(next.filter((item) => item.mediaType === 'movie'))).toEqual(['m2', 'm3', 'm1'])
    expect(ids(next.filter((item) => item.mediaType === 'tv'))).toEqual(['tv1', 'tv2'])
    expect(next).toHaveLength(playlist.length)
  })

  it('in a filtered view, "to top" means the top of what the user sees', () => {
    const next = moveItemToPosition(list('tv1', 'm1', 'm2', 'm3'), 'm3', 'm1')
    expect(ids(next)).toEqual(['tv1', 'm3', 'm1', 'm2'])
  })

  it('returns null for an unknown id or a move onto itself, and never mutates its input', () => {
    const playlist = list('a', 'b', 'c')
    expect(moveItemToPosition(playlist, 'a', 'a')).toBeNull()
    expect(moveItemToPosition(playlist, 'a', 'missing')).toBeNull()
    expect(moveItemToPosition(playlist, 'missing', 'a')).toBeNull()

    moveItemToPosition(playlist, 'a', 'c')
    expect(ids(playlist)).toEqual(['a', 'b', 'c'])
  })
})
