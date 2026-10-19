/**
 * @jest-environment node
 *
 * The expected side of the show's drift check: the seasons and episodes a
 * server says a show has, counting only seasons the sync can store.
 */

const { expectedSeasonCounts } = require('@src/utils/sync/core/seasonCounts')

describe('expectedSeasonCounts', () => {
  it('counts every season key with a number in it, and their episodes', () => {
    expect(
      expectedSeasonCounts([
        ['Season 1', 3],
        ['Season01', 2],
        ['S2', 1],
        ['season_3', 0],
      ])
    ).toEqual({ seasons: 4, episodes: 6 })
  })

  it('leaves out a season the sync never stores, and its episodes', () => {
    expect(expectedSeasonCounts([['Specials', 5], ['Extras', 2], ['Season 1', 1]])).toEqual({ seasons: 1, episodes: 1 })
  })

  it('is zero for no seasons', () => {
    expect(expectedSeasonCounts([])).toEqual({ seasons: 0, episodes: 0 })
  })

  it('gives the same answer every call (no regex state between calls)', () => {
    const seasons = [['Season 1', 1], ['Season 2', 1]]
    expect(expectedSeasonCounts(seasons)).toEqual(expectedSeasonCounts(seasons))
  })
})
