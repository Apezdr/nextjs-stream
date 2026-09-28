/**
 * The database now sorts a playlist before paging it. Title and release-date
 * order used to be applied in memory after the TMDB lookups, one page at a
 * time, so a playlist longer than a page was only sorted within each page.
 * These stages were also run on MongoDB 8.3 to confirm the order they give.
 */
import {
  DETAILS_RESOLVED_AT,
  SORTS_NEEDING_DETAILS,
  TITLE_COLLATION,
  sortDetailUpdates,
  sortDetailsFrom,
  watchlistOrderStages,
} from '@src/utils/watchlist/listOrder'

describe('watchlistOrderStages', () => {
  it('sorts date added in the direction asked, with _id breaking ties', () => {
    expect(watchlistOrderStages({ sortBy: 'dateAdded', sortOrder: 'asc' })).toEqual({
      stages: [{ $sort: { dateAdded: 1, _id: 1 } }],
      collation: null,
    })
    expect(watchlistOrderStages({ sortBy: 'dateAdded', sortOrder: 'desc' }).stages).toEqual([
      { $sort: { dateAdded: -1, _id: -1 } },
    ])
  })

  it('sorts titles case-insensitively, ties newest first', () => {
    expect(watchlistOrderStages({ sortBy: 'title', sortOrder: 'asc' })).toEqual({
      stages: [{ $sort: { title: 1, dateAdded: -1, _id: -1 } }],
      collation: TITLE_COLLATION,
    })
    expect(TITLE_COLLATION).toEqual({ locale: 'en', strength: 2 })
  })

  it('puts an unknown release date after every known one, then drops the helper field', () => {
    const { stages } = watchlistOrderStages({ sortBy: 'releaseDate', sortOrder: 'desc' })
    expect(stages[0].$addFields._releaseOrder.$cond[2]).toBe('9999-12-31')
    expect(stages[1]).toEqual({ $sort: { _releaseOrder: -1, dateAdded: -1, _id: -1 } })
    expect(stages[2]).toEqual({ $project: { _releaseOrder: 0 } })
  })

  it('orders by position in the custom order, ids passed as literals', () => {
    const { stages } = watchlistOrderStages({ sortBy: 'custom', customOrder: ['b', 'a'] })
    const position = stages[0].$addFields._customOrder.$let.vars.position
    expect(position).toEqual({ $indexOfArray: [{ $literal: ['b', 'a'] }, { $toString: '$_id' }] })
    expect(stages[1]).toEqual({ $sort: { _customOrder: 1, dateAdded: -1, _id: -1 } })
  })

  it('falls back to newest first for an empty custom order or an unknown sort', () => {
    const newestFirst = { stages: [{ $sort: { dateAdded: -1, _id: -1 } }], collation: null }
    expect(watchlistOrderStages({ sortBy: 'custom', customOrder: [] })).toEqual(newestFirst)
    expect(watchlistOrderStages({ sortBy: 'custom' })).toEqual(newestFirst)
    expect(watchlistOrderStages({ sortBy: 'popularity', sortOrder: 'asc' })).toEqual(newestFirst)
  })

  it('names the sorts that need stored details', () => {
    expect([...SORTS_NEEDING_DETAILS]).toEqual(['title', 'releaseDate'])
  })
})

describe('sortDetailsFrom', () => {
  it('takes the title and a YYYY-MM-DD release date', () => {
    expect(sortDetailsFrom({ title: ' Alien ', releaseDate: '1979-05-25' })).toEqual({
      title: 'Alien',
      releaseDate: '1979-05-25',
    })
  })

  it('never offers a blank title, and stores no date rather than a malformed one', () => {
    expect(sortDetailsFrom({ title: '  ', releaseDate: '' })).toEqual({ releaseDate: null })
    expect(sortDetailsFrom({ releaseDate: '1979' })).toEqual({ releaseDate: null })
  })
})

describe('sortDetailUpdates', () => {
  const now = new Date('2026-09-27T12:00:00Z')
  const item = (fields) => ({ _id: `id-${fields.tmdbId}`, mediaType: 'movie', ...fields })
  const resolved = (entries) => new Map(entries.map((entry) => [entry.tmdbId, { mediaType: 'movie', ...entry }]))

  it('stores what an item resolved to, marking it resolved', () => {
    const updates = sortDetailUpdates(
      [item({ tmdbId: 1, title: 'alien' })],
      resolved([{ tmdbId: 1, title: 'Alien', releaseDate: '1979-05-25' }]),
      now
    )
    expect(updates).toEqual([
      {
        updateOne: {
          filter: { _id: 'id-1' },
          update: { $set: { title: 'Alien', releaseDate: '1979-05-25', [DETAILS_RESOLVED_AT]: now } },
        },
      },
    ])
  })

  it('writes nothing for an item already up to date', () => {
    const upToDate = item({ tmdbId: 1, title: 'Alien', releaseDate: '1979-05-25', [DETAILS_RESOLVED_AT]: now })
    expect(sortDetailUpdates([upToDate], resolved([{ tmdbId: 1, title: 'Alien', releaseDate: '1979-05-25' }]))).toEqual([])
  })

  it('marks an up-to-date item that was never marked', () => {
    const unmarked = item({ tmdbId: 1, title: 'Alien', releaseDate: '1979-05-25' })
    const [update] = sortDetailUpdates([unmarked], resolved([{ tmdbId: 1, title: 'Alien', releaseDate: '1979-05-25' }]), now)
    expect(update.updateOne.update.$set[DETAILS_RESOLVED_AT]).toBe(now)
  })

  it('leaves out failed lookups, so they are tried again', () => {
    expect(sortDetailUpdates([item({ tmdbId: 1 })], new Map())).toEqual([])
  })

  it("never takes another media type's title under the same TMDB id", () => {
    const show = new Map([[1, { tmdbId: 1, mediaType: 'tv', title: 'A Show' }]])
    expect(sortDetailUpdates([item({ tmdbId: 1, title: 'A Film' })], show)).toEqual([])
  })

  it('keeps the stored title of one TMDB no longer has, and only marks it', () => {
    const gone = new Map([[1, { tmdbId: 1, mediaType: 'movie', tmdbNotFound: true, title: 'No longer on TMDB' }]])
    const [update] = sortDetailUpdates([item({ tmdbId: 1, title: 'Old Film' })], gone, now)
    expect(update.updateOne.update).toEqual({ $set: { [DETAILS_RESOLVED_AT]: now } })
  })
})
