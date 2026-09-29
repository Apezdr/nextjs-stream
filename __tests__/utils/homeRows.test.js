/**
 * @jest-environment node
 */
/**
 * Home screen rows on the server (homeRows.js), against a small in-memory
 * stand-in for MongoDB. A row only shows for a playlist its person can open,
 * so every function here has to apply that rule, for whoever it's asked about.
 */
const { ObjectId } = require('mongodb')

// ---- a little in-memory MongoDB: enough query and update support for homeRows.js

const same = (a, b) => (a instanceof ObjectId || b instanceof ObjectId ? String(a) === String(b) : a === b)
const read = (doc, path) =>
  path.split('.').reduce((value, key) => {
    if (value == null) return undefined
    return Array.isArray(value) ? value.map((entry) => entry?.[key]) : value[key]
  }, doc)
const equals = (actual, expected) => (Array.isArray(actual) ? actual.some((entry) => same(entry, expected)) : same(actual, expected))
const isOperator = (value) => value && typeof value === 'object' && !(value instanceof ObjectId) && !(value instanceof Date)

function matches(doc, filter) {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') return condition.some((branch) => matches(doc, branch))
    const actual = read(doc, key)
    if (!isOperator(condition)) return equals(actual, condition)
    return Object.entries(condition).every(([operator, argument]) => {
      if (operator === '$in') return argument.some((value) => equals(actual, value))
      if (operator === '$nin') return !argument.some((value) => equals(actual, value))
      if (operator === '$exists') return (actual !== undefined) === argument
      throw new Error(`fake mongo: ${operator} unsupported`)
    })
  })
}

function applyUpdate(doc, update, inserting) {
  Object.assign(doc, update.$set)
  if (inserting) Object.assign(doc, update.$setOnInsert)
  for (const [field, step] of Object.entries(update.$inc || {})) doc[field] = (doc[field] || 0) + step
}

function aggregate(docs, pipeline) {
  let rows = docs
  for (const stage of pipeline) {
    if (stage.$match) rows = rows.filter((doc) => matches(doc, stage.$match))
    if (stage.$group) {
      const { _id, ...accumulators } = stage.$group
      const groups = new Map()
      for (const doc of rows) {
        const key = doc[_id.slice(1)]
        if (!groups.has(String(key))) groups.set(String(key), { _id: key })
        const group = groups.get(String(key))
        for (const [name, accumulator] of Object.entries(accumulators)) {
          if ('$sum' in accumulator) group[name] = (group[name] || 0) + accumulator.$sum
          if ('$max' in accumulator) {
            const value = doc[accumulator.$max.slice(1)]
            group[name] = group[name] === undefined ? value : Math.max(group[name], value)
          }
        }
      }
      rows = [...groups.values()]
    }
  }
  return rows
}

function fakeCollection(docs) {
  return {
    docs,
    find: (filter = {}) => ({ toArray: async () => docs.filter((doc) => matches(doc, filter)).map((doc) => ({ ...doc })) }),
    findOne: async (filter) => docs.find((doc) => matches(doc, filter)) || null,
    aggregate: (pipeline) => ({ toArray: async () => aggregate(docs, pipeline) }),
    updateMany: async (filter, update) => {
      const hits = docs.filter((doc) => matches(doc, filter))
      hits.forEach((doc) => applyUpdate(doc, update, false))
      return { modifiedCount: hits.length }
    },
    bulkWrite: async (operations) => {
      for (const operation of operations) {
        if (operation.updateMany) {
          docs.filter((doc) => matches(doc, operation.updateMany.filter)).forEach((doc) => applyUpdate(doc, operation.updateMany.update, false))
        }
        if (operation.updateOne) {
          const { filter, update, upsert } = operation.updateOne
          const found = docs.find((doc) => matches(doc, filter))
          if (found) applyUpdate(found, update, false)
          else if (upsert) {
            const created = { _id: new ObjectId(), ...filter }
            applyUpdate(created, update, true)
            docs.push(created)
          }
        }
      }
      return {}
    },
  }
}

// ---- the world: five people, four playlists

const id = () => new ObjectId()
const ME = id()
const JORDAN = id()
const PRIYA = id()
const SAM = id()
const ADMIN = id()
const MINE = id() // my private watchlist
const MOVIE_NIGHT = id() // Sam's, shared with me
const STAFF_PICKS = id() // Priya's, public
const JORDANS = id() // Jordan's private watchlist

const USERS = [
  { _id: ME, name: 'Morgan Me', email: 'me@example.com' },
  { _id: JORDAN, name: 'Jordan Lee', email: 'jordan@example.com' },
  { _id: PRIYA, name: 'Priya Shah', email: 'priya@example.com' },
  { _id: SAM, name: 'Sam Rivera', email: 'sam@example.com' },
  { _id: ADMIN, name: 'Alex Admin', email: 'admin@example.com', role: 'admin' },
]

let db
function resetWorld() {
  const at = (day) => new Date(`2026-09-${String(day).padStart(2, '0')}T12:00:00Z`)
  db = {
    'Media.Playlists': fakeCollection([
      { _id: MINE, name: 'My Watchlist', ownerId: ME, privacy: 'private', collaborators: [], dateUpdated: at(1) },
      { _id: MOVIE_NIGHT, name: 'Movie Night', ownerId: SAM, privacy: 'private', collaborators: [{ userId: ME, permission: 'add' }], dateUpdated: at(2) },
      { _id: STAFF_PICKS, name: 'Staff Picks', ownerId: PRIYA, privacy: 'public', collaborators: [], dateUpdated: at(3) },
      { _id: JORDANS, name: 'My Watchlist', ownerId: JORDAN, privacy: 'private', collaborators: [], dateUpdated: at(4) },
    ]),
    'Media.Watchlist': fakeCollection([
      { _id: id(), playlistId: MINE },
      { _id: id(), playlistId: MINE },
      { _id: id(), playlistId: STAFF_PICKS },
    ]),
    'Users.PlaylistVisibility': fakeCollection([
      { _id: id(), userId: ME, playlistId: STAFF_PICKS, showInApp: true, appOrder: 1, appTitle: 'Picks', hideUnavailable: true },
      { _id: id(), userId: ME, playlistId: MINE, showInApp: true, appOrder: 0, appTitle: null, hideUnavailable: false },
      // A row for a playlist I can't open: the home page never shows it
      { _id: id(), userId: ME, playlistId: JORDANS, showInApp: true, appOrder: 2, appTitle: null, hideUnavailable: false },
      // Not a row, but its library choice counts
      { _id: id(), userId: ME, playlistId: MOVIE_NIGHT, showInApp: false, appOrder: 0, appTitle: null, hideUnavailable: true },
      // Sam: a stale row he can't open, then Staff Picks, then his own Movie Night
      { _id: id(), userId: SAM, playlistId: JORDANS, showInApp: true, appOrder: 0 },
      { _id: id(), userId: SAM, playlistId: STAFF_PICKS, showInApp: true, appOrder: 1 },
      { _id: id(), userId: SAM, playlistId: MOVIE_NIGHT, showInApp: true, appOrder: 2, appTitle: 'Fridays' },
      // Jordan has their own watchlist as a row
      { _id: id(), userId: JORDAN, playlistId: JORDANS, showInApp: true, appOrder: 0 },
      // Priya already shows Staff Picks
      { _id: id(), userId: PRIYA, playlistId: STAFF_PICKS, showInApp: true, appOrder: 0 },
      // The admin has two rows, ordered 0 and 3
      { _id: id(), userId: ADMIN, playlistId: MINE, showInApp: true, appOrder: 0 },
      { _id: id(), userId: ADMIN, playlistId: JORDANS, showInApp: true, appOrder: 3 },
    ]),
  }
}

jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({ db: (name) => ({ collection: (collection) => db[`${name}.${collection}`] }) }),
}))
jest.mock('@src/lib/userQueries', () => {
  const pick = (user, projection) => (projection && Object.keys(projection).length ? user : user)
  return {
    userQueries: {
      findById: async (userId, projection) => {
        const user = USERS.find((candidate) => String(candidate._id) === String(userId))
        return user ? pick(user, projection) : null
      },
      find: async (query) => USERS.filter((user) => query._id.$in.some((wanted) => String(wanted) === String(user._id))),
      findAll: async () => USERS.map((user) => ({ ...user })),
    },
  }
})
jest.mock('@src/utils/watchlist/playlistVisibilityIndexes.js', () => ({ ensurePlaylistVisibilityIndexes: async () => {} }))

const {
  addPlaylistToHomeScreens,
  cleanRows,
  getHomeRows,
  listHomeRowPeople,
  listPeopleWithRowCounts,
  playlistRelation,
  removePlaylistFromHomeScreens,
  saveHomeRows,
} = require('@src/utils/watchlist/homeRows')

const visibility = () => db['Users.PlaylistVisibility'].docs
const prefOf = (userId, playlistId) =>
  visibility().find((pref) => String(pref.userId) === String(userId) && String(pref.playlistId) === String(playlistId))

beforeEach(resetWorld)

describe('playlistRelation', () => {
  it("names how someone stands with a playlist, or null if they can't open it", () => {
    const [mine, movieNight, staffPicks, jordans] = db['Media.Playlists'].docs
    expect(playlistRelation(mine, String(ME), false)).toBe('yours')
    expect(playlistRelation(movieNight, String(ME), false)).toBe('shared')
    expect(playlistRelation(staffPicks, String(ME), false)).toBe('public')
    expect(playlistRelation(jordans, String(ME), false)).toBeNull()
    expect(playlistRelation(jordans, String(ADMIN), true)).toBe('others')
  })
})

describe('getHomeRows', () => {
  it('lists the rows in home-screen order, leaving out playlists the person cannot open', async () => {
    const { rows, person } = await getHomeRows(String(ME))

    expect(person).toMatchObject({ name: 'Morgan Me', isAdmin: false })
    expect(rows.map((row) => row.playlist.name)).toEqual(['My Watchlist', 'Staff Picks'])
    expect(rows[0].playlist).toMatchObject({ relation: 'yours', ownerName: 'Morgan Me', itemCount: 2 })
    expect(rows[1]).toMatchObject({ appTitle: 'Picks', hideUnavailable: true })
    expect(rows[1].playlist).toMatchObject({ relation: 'public', ownerName: 'Priya Shah', itemCount: 1 })
  })

  it('offers the playlists the person could add, with their library choice', async () => {
    const { available } = await getHomeRows(String(ME))

    expect(available).toEqual([
      expect.objectContaining({ name: 'Movie Night', relation: 'shared', ownerName: 'Sam Rivera', hideUnavailable: true }),
    ])
  })

  it("offers an admin other people's private playlists, marked as such", async () => {
    const { available } = await getHomeRows(String(ADMIN))

    expect(available.map((playlist) => [playlist.name, playlist.ownerName, playlist.relation])).toEqual([
      ['Staff Picks', 'Priya Shah', 'public'],
      ['Movie Night', 'Sam Rivera', 'others'],
    ])
  })
})

describe('saveHomeRows', () => {
  it('replaces the rows in order, and turns off the ones left out', async () => {
    await saveHomeRows(String(ME), [
      { playlistId: String(MOVIE_NIGHT), appTitle: '  Friday films ', hideUnavailable: false },
      { playlistId: String(MINE), appTitle: '', hideUnavailable: true },
    ])

    expect(prefOf(ME, MOVIE_NIGHT)).toMatchObject({ showInApp: true, appOrder: 0, appTitle: 'Friday films', hideUnavailable: false })
    expect(prefOf(ME, MINE)).toMatchObject({ showInApp: true, appOrder: 1, appTitle: null, hideUnavailable: true })
    expect(prefOf(ME, STAFF_PICKS)).toMatchObject({ showInApp: false, hideUnavailable: true })
    expect(prefOf(ME, JORDANS)).toMatchObject({ showInApp: false })
  })

  it("refuses a playlist the person can't open", async () => {
    await expect(saveHomeRows(String(ME), [{ playlistId: String(JORDANS) }])).rejects.toMatchObject({ status: 403 })
    expect(prefOf(ME, MINE).showInApp).toBe(true)
  })

  it('refuses rows it cannot make sense of', () => {
    expect(() => cleanRows('not a list')).toThrow('rows must be an array')
    expect(() => cleanRows([{ playlistId: 'nope' }])).toThrow('valid playlistId')
    expect(() => cleanRows([{ playlistId: String(MINE) }, { playlistId: String(MINE) }])).toThrow('listed twice')
    expect(() => cleanRows([{ playlistId: String(MINE), appTitle: 'x'.repeat(101) }])).toThrow('100 characters')
  })
})

describe('listHomeRowPeople', () => {
  it('shows who can open a private playlist, and where it sits on their home screen', async () => {
    const { playlist, people, counts } = await listHomeRowPeople(String(MOVIE_NIGHT))
    const byName = Object.fromEntries(people.map((person) => [person.name, person]))

    expect(playlist).toMatchObject({ name: 'Movie Night', ownerName: 'Sam Rivera', privacy: 'private', collaboratorCount: 1 })
    // Row 2, not 3: the stale row for Jordan's watchlist doesn't show on Sam's home screen
    expect(byName['Sam Rivera']).toMatchObject({ canOpen: true, role: 'owner', row: { position: 2, appTitle: 'Fridays' } })
    expect(byName['Morgan Me']).toMatchObject({ canOpen: true, role: 'collaborator', row: null })
    expect(byName['Alex Admin']).toMatchObject({ canOpen: true, role: 'admin', row: null })
    expect(byName['Jordan Lee']).toMatchObject({ canOpen: false, row: null })
    expect(counts).toEqual({ all: 5, showing: 1, notShowing: 2, noAccess: 2 })
  })
})

describe('listPeopleWithRowCounts', () => {
  it("counts only the rows each person's home screen shows", async () => {
    const people = await listPeopleWithRowCounts()
    const counts = Object.fromEntries(people.map((person) => [person.name, person.rowCount]))

    expect(counts).toEqual({ 'Alex Admin': 2, 'Jordan Lee': 1, 'Morgan Me': 2, 'Priya Shah': 1, 'Sam Rivera': 2 })
  })
})

describe('addPlaylistToHomeScreens', () => {
  it('adds it as the first row, moving their other rows down', async () => {
    const result = await addPlaylistToHomeScreens(String(STAFF_PICKS), { userIds: [String(JORDAN), String(PRIYA)], position: 'top' })

    expect(result).toEqual({ added: [String(JORDAN)], alreadyShowing: 1, skipped: 0 })
    expect(prefOf(JORDAN, STAFF_PICKS)).toMatchObject({ showInApp: true, appOrder: 0, appTitle: null, hideUnavailable: false })
    expect(prefOf(JORDAN, JORDANS).appOrder).toBe(1)
    // Priya already had it: untouched
    expect(prefOf(PRIYA, STAFF_PICKS).appOrder).toBe(0)
  })

  it('adds it as the last row, after their highest', async () => {
    await addPlaylistToHomeScreens(String(STAFF_PICKS), { userIds: [String(ADMIN)], position: 'bottom' })

    expect(prefOf(ADMIN, STAFF_PICKS)).toMatchObject({ showInApp: true, appOrder: 4 })
  })

  it("skips people who can't open it, and adds for everyone else when asked for everyone", async () => {
    const skipped = await addPlaylistToHomeScreens(String(MOVIE_NIGHT), { userIds: [String(JORDAN)] })
    expect(skipped).toEqual({ added: [], alreadyShowing: 0, skipped: 1 })

    const everyone = await addPlaylistToHomeScreens(String(MOVIE_NIGHT), { userIds: null })
    expect(everyone.added.sort()).toEqual([String(ME), String(ADMIN)].sort())
    // My hidden Movie Night pref comes back on, keeping its library choice
    expect(prefOf(ME, MOVIE_NIGHT)).toMatchObject({ showInApp: true, hideUnavailable: true })
  })
})

describe('removePlaylistFromHomeScreens', () => {
  it("takes it off everyone's home screen, keeping their choices", async () => {
    const { removed } = await removePlaylistFromHomeScreens(String(STAFF_PICKS), { userIds: null })

    expect(removed.sort()).toEqual([String(ME), String(SAM), String(PRIYA)].sort())
    expect(prefOf(ME, STAFF_PICKS)).toMatchObject({ showInApp: false, appTitle: 'Picks', hideUnavailable: true })
  })

  it('takes it off only the people named', async () => {
    const { removed } = await removePlaylistFromHomeScreens(String(STAFF_PICKS), { userIds: [String(SAM)] })

    expect(removed).toEqual([String(SAM)])
    expect(prefOf(ME, STAFF_PICKS).showInApp).toBe(true)
  })
})
