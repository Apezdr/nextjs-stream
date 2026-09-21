/**
 * "Recently Added" ranks on the library-add date, not the video file's mtime.
 *
 * The three fixtures below are the three kinds of title found in a prod audit
 * of the rail (top 100 movies by mtime: 32 promoted by a replaced file, 43
 * buried by a preserved mtime, 25 correct). Under the old mtime ordering the
 * upgraded title ranked first and the genuinely new one ranked last.
 */

import { getAddedDate, arrangeMediaByAddedDate } from '@src/utils/auth_utils'

// Added in July, file replaced by a quality upgrade in September.
const upgraded = {
  title: 'Upgraded In Place',
  type: 'movie',
  initialDiscoveryDate: '2026-07-21T00:00:00.000Z',
  mediaLastModified: '2026-09-17T00:00:00.000Z',
}
// Added last week, downloaded with its original 2019 mtime preserved.
const preservedMtime = {
  title: 'New But Old Mtime',
  type: 'movie',
  initialDiscoveryDate: '2026-09-18T00:00:00.000Z',
  mediaLastModified: '2019-07-03T00:00:00.000Z',
}
// Added and written on the same day.
const ordinary = {
  title: 'Ordinary Arrival',
  type: 'movie',
  initialDiscoveryDate: '2026-09-12T00:00:00.000Z',
  mediaLastModified: '2026-09-12T00:00:00.000Z',
}

describe('getAddedDate', () => {
  it('is the library-add date, whatever the file mtime says', () => {
    expect(getAddedDate(upgraded)).toBe(Date.parse('2026-07-21T00:00:00.000Z'))
    expect(getAddedDate(preservedMtime)).toBe(Date.parse('2026-09-18T00:00:00.000Z'))
  })

  it('falls back to mtime only for a record that predates the field', () => {
    expect(getAddedDate({ mediaLastModified: '2026-05-05T00:00:00.000Z' })).toBe(
      Date.parse('2026-05-05T00:00:00.000Z')
    )
    // A null date (a show whose episodes all predate the field) is "absent".
    expect(
      getAddedDate({ initialDiscoveryDate: null, mediaLastModified: '2026-05-05T00:00:00.000Z' })
    ).toBe(Date.parse('2026-05-05T00:00:00.000Z'))
  })

  it('reads an episode-shaped record', () => {
    expect(getAddedDate({ episode: { initialDiscoveryDate: '2026-09-20T00:00:00.000Z' } })).toBe(
      Date.parse('2026-09-20T00:00:00.000Z')
    )
  })

  it('is 0 for a record with no usable date, so it sorts last instead of throwing', () => {
    expect(getAddedDate({})).toBe(0)
    expect(getAddedDate(null)).toBe(0)
    expect(getAddedDate({ initialDiscoveryDate: 'not a date' })).toBe(0)
  })
})

describe('arrangeMediaByAddedDate', () => {
  it('puts the genuinely new title first and the upgraded one where it belongs', () => {
    const titles = arrangeMediaByAddedDate([upgraded, preservedMtime, ordinary], []).map((m) => m.title)
    expect(titles).toEqual(['New But Old Mtime', 'Ordinary Arrival', 'Upgraded In Place'])
  })

  it('interleaves movies and shows on one timeline', () => {
    // A show carries its NEWEST EPISODE's add date (getFlatRecentlyAddedMedia
    // overrides the show document's own date with the episode group's max).
    const show = {
      title: 'Weekly Show',
      type: 'tv',
      initialDiscoveryDate: '2026-09-15T00:00:00.000Z',
      mediaLastModified: '2026-09-15T00:00:00.000Z',
    }
    const titles = arrangeMediaByAddedDate([preservedMtime, ordinary], [show]).map((m) => m.title)
    expect(titles).toEqual(['New But Old Mtime', 'Weekly Show', 'Ordinary Arrival'])
  })

  it('breaks a tie on mtime — migration cohorts share one add date', () => {
    const cohortDate = '2026-06-20T00:00:00.000Z'
    const older = { title: 'Cohort Older File', initialDiscoveryDate: cohortDate, mediaLastModified: '2024-01-01T00:00:00.000Z' }
    const newer = { title: 'Cohort Newer File', initialDiscoveryDate: cohortDate, mediaLastModified: '2026-02-02T00:00:00.000Z' }

    expect(arrangeMediaByAddedDate([older, newer], []).map((m) => m.title)).toEqual([
      'Cohort Newer File',
      'Cohort Older File',
    ])
  })

  it('does not mutate its inputs', () => {
    const movies = [upgraded, preservedMtime]
    arrangeMediaByAddedDate(movies, [])
    expect(movies.map((m) => m.title)).toEqual(['Upgraded In Place', 'New But Old Mtime'])
  })
})
