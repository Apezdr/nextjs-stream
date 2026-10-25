/**
 * @jest-environment node
 *
 * /api/authenticated/media sends at most RESPONSE_CAST_LIMIT cast members and
 * guest stars, each with only CAST_MEMBER_FIELDS, plus the counts. Each field
 * below names its reader; a field with no reader left should leave both lists.
 */
const {
  CAST_MEMBER_FIELDS,
  RESPONSE_CAST_LIMIT,
  limitResponseCast,
  limitTmdbDetailsCast,
} = require('@src/utils/media/responseCast')

const READERS = {
  // Web PopupCard CastGridCell (TMDB person link and React key); TV app media-info list keys
  id: 'web, tv app',
  // CastGridCell, CastRail; TV app media-info and episode screens
  name: 'web, tv app',
  character: 'web, tv app',
  profile_path: 'web, tv app',
}

const member = (i) => ({
  id: i,
  name: `Person ${i}`,
  character: `Role ${i}`,
  profile_path: `/p${i}.jpg`,
  roles: [{ credit_id: `c${i}`, character: `Role ${i}`, episode_count: 3 }],
  known_for_department: 'Acting',
  total_episode_count: 3,
  type: 'main',
})
const members = (n, from = 0) => Array.from({ length: n }, (_, i) => member(from + i))

it('names a reader for every cast member field it keeps', () => {
  expect([...CAST_MEMBER_FIELDS].sort()).toEqual(Object.keys(READERS).sort())
})

it('matches the web rail (CastRail RAIL_LIMIT)', () => {
  expect(RESPONSE_CAST_LIMIT).toBe(24)
})

it('sends the first 24 of a long cast, in order, and how many there are', () => {
  const result = limitResponseCast({ title: 'Show', cast: members(907) })

  expect(result.castCount).toBe(907)
  expect(result.cast).toHaveLength(24)
  expect(result.cast.map((m) => m.id)).toEqual(members(24).map((m) => m.id))
  expect(result.cast[0]).toEqual({ id: 0, name: 'Person 0', character: 'Role 0', profile_path: '/p0.jpg' })
})

it('caps guest stars the same way', () => {
  const result = limitResponseCast({ cast: members(3), guestStars: members(30, 100) })

  expect(result.guestStarsCount).toBe(30)
  expect(result.guestStars).toHaveLength(24)
  expect(result.guestStars[0]).toEqual({ id: 100, name: 'Person 100', character: 'Role 100', profile_path: '/p100.jpg' })
})

it('sends a short cast whole, with its count, and an empty one as empty', () => {
  expect(limitResponseCast({ cast: members(5) }).castCount).toBe(5)
  expect(limitResponseCast({ cast: members(5) }).cast).toHaveLength(5)
  expect(limitResponseCast({ cast: [] })).toEqual({ cast: [], castCount: 0 })
})

it('drops the metadata copies and the recurring cast', () => {
  const result = limitResponseCast({
    cast: members(30),
    metadata: { overview: 'Plot', cast: members(30), guest_stars: members(2), recurring_cast: members(138), crew: [{ id: 9, job: 'Director' }] },
  })

  expect(result.metadata).toEqual({ overview: 'Plot', crew: [{ id: 9, job: 'Director' }] })
})

it('takes the list from metadata when the top level has none', () => {
  const result = limitResponseCast({ metadata: { cast: members(40), guest_stars: members(2, 50) } })

  expect(result.castCount).toBe(40)
  expect(result.cast).toHaveLength(24)
  expect(result.guestStarsCount).toBe(2)
  expect(result.metadata).toEqual({})
})

it('adds nothing to a response without a cast, such as a season list', () => {
  const season = { title: 'Show', seasonNumber: 2, episodes: [{ episodeNumber: 1 }], metadata: { overview: 'Plot' } }

  expect(limitResponseCast(season)).toEqual(season)
})

it('skips empty entries and does not change its input', () => {
  const input = { cast: [member(1), null, member(2)], metadata: { cast: [member(1)] } }
  const copy = JSON.parse(JSON.stringify(input))

  const result = limitResponseCast(input)

  expect(result.castCount).toBe(2)
  expect(result.cast.map((m) => m.id)).toEqual([1, 2])
  expect(input).toEqual(copy)
})

it('passes null and non-objects through', () => {
  expect(limitResponseCast(null)).toBeNull()
  expect(limitResponseCast(undefined)).toBeUndefined()
})

it("caps TMDB's details the same way and drops their recurring cast", () => {
  const details = { id: 1399, name: 'Show', cast: members(587), recurring_cast: members(81), crew: [{ id: 1 }] }
  const result = limitTmdbDetailsCast(details)

  expect(result.cast).toHaveLength(24)
  expect(result.castCount).toBe(587)
  expect(result).not.toHaveProperty('recurring_cast')
  expect(result.crew).toEqual([{ id: 1 }])
  // The input is not changed
  expect(details.cast).toHaveLength(587)
  expect(details.recurring_cast).toHaveLength(81)
  expect(limitTmdbDetailsCast(null)).toBeNull()
})
