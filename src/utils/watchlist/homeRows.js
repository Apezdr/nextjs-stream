/**
 * Home screen rows: which playlists show as rows on a person's home screen,
 * in what order and under what title. Stored per person and playlist in
 * Users.PlaylistVisibility ({ userId, playlistId, showInApp, appOrder,
 * appTitle, hideUnavailable }).
 *
 * A row only ever shows for a playlist its person can open. The home page
 * builds rows from getUserPlaylists: playlists the person owns, collaborates
 * on, or that are public, and every playlist for an admin. Everything here
 * applies that rule, for the signed-in person or, for an admin, anyone.
 *
 * A plain server module, not part of database.js: every export of a
 * 'use server' file is a callable endpoint, and these take a user id.
 */
import { ObjectId } from 'mongodb'
import clientPromise from '@src/lib/mongodb'
import { userQueries } from '@src/lib/userQueries'
import { ensurePlaylistVisibilityIndexes } from './playlistVisibilityIndexes.js'

export const MAX_HOME_ROWS = 50
export const MAX_ROW_TITLE_LENGTH = 100

/** A request the caller can fix: the route answers with `status`. */
export class HomeRowsError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'HomeRowsError'
    this.status = status
  }
}

const OBJECT_ID = /^[0-9a-f]{24}$/i
const isId = (value) => typeof value === 'string' && OBJECT_ID.test(value)
// Ids arrive as ObjectIds or strings depending on the document's age
const sameId = (a, b) => a != null && b != null && String(a) === String(b)

// Same test as database.js and the watchlist route
export function isGlobalAdminUser(user) {
  if (!user) return false
  return (
    user.role === 'admin' ||
    user.role === 'Admin' ||
    (Array.isArray(user.permissions) && user.permissions.includes('Admin'))
  )
}

/**
 * How a person stands with a playlist: 'yours' (they own it), 'shared' (they
 * collaborate on it), 'public', 'others' (they can open it only because
 * they're an admin), or null (they can't open it).
 */
export function playlistRelation(playlist, userId, isAdmin) {
  if (!playlist) return null
  if (sameId(playlist.ownerId, userId)) return 'yours'
  if (Array.isArray(playlist.collaborators) && playlist.collaborators.some((collaborator) => sameId(collaborator?.userId, userId))) {
    return 'shared'
  }
  if (playlist.privacy === 'public') return 'public'
  return isAdmin ? 'others' : null
}

const RELATION_ORDER = ['yours', 'shared', 'public', 'others']

/**
 * Checks and tidies the rows a client sends: [{ playlistId, appTitle,
 * hideUnavailable }] in home-screen order. A blank title becomes null (the
 * row uses the playlist's name).
 */
export function cleanRows(rows) {
  if (!Array.isArray(rows)) throw new HomeRowsError('rows must be an array')
  if (rows.length > MAX_HOME_ROWS) throw new HomeRowsError(`A home screen holds at most ${MAX_HOME_ROWS} rows`)
  const seen = new Set()
  return rows.map((row) => {
    const playlistId = row?.playlistId
    if (!isId(playlistId)) throw new HomeRowsError('Each row needs a valid playlistId')
    if (seen.has(playlistId)) throw new HomeRowsError(`Playlist ${playlistId} is listed twice`)
    seen.add(playlistId)
    if (row.appTitle != null && typeof row.appTitle !== 'string') throw new HomeRowsError('appTitle must be text')
    const appTitle = (row.appTitle || '').trim()
    if (appTitle.length > MAX_ROW_TITLE_LENGTH) {
      throw new HomeRowsError(`A row title is ${MAX_ROW_TITLE_LENGTH} characters at most`)
    }
    return { playlistId, appTitle: appTitle || null, hideUnavailable: row.hideUnavailable === true }
  })
}

function cleanUserIds(userIds) {
  if (!Array.isArray(userIds) || userIds.some((id) => !isId(id))) {
    throw new HomeRowsError('userIds must be a list of user ids')
  }
  return [...new Set(userIds)]
}

async function collections() {
  const client = await clientPromise
  return {
    playlists: client.db('Media').collection('Playlists'),
    watchlist: client.db('Media').collection('Watchlist'),
    visibility: client.db('Users').collection('PlaylistVisibility'),
  }
}

const PLAYLIST_FIELDS = { name: 1, ownerId: 1, collaborators: 1, privacy: 1, dateUpdated: 1 }
const USER_FIELDS = { _id: 1, name: 1, email: 1, role: 1, permissions: 1 }

// The query getUserPlaylists runs, so these are the playlists the home page
// can make rows of
function playlistsOpenTo(playlists, userObjectId, isAdmin) {
  const filter = isAdmin
    ? {}
    : { $or: [{ ownerId: userObjectId }, { 'collaborators.userId': userObjectId }, { privacy: 'public' }] }
  return playlists.find(filter, { projection: PLAYLIST_FIELDS }).toArray()
}

function displayName(user) {
  return user?.name || user?.email || 'Unknown user'
}

async function nameMap(userIds) {
  const ids = [...new Set(userIds.map(String))].filter(isId)
  if (ids.length === 0) return new Map()
  const users = await userQueries.find({ _id: { $in: ids.map((id) => new ObjectId(id)) } }, { _id: 1, name: 1, email: 1 })
  return new Map(users.map((user) => [String(user._id), displayName(user)]))
}

async function itemCounts(watchlist, playlistIds) {
  if (playlistIds.length === 0) return new Map()
  const counts = await watchlist
    .aggregate([{ $match: { playlistId: { $in: playlistIds } } }, { $group: { _id: '$playlistId', count: { $sum: 1 } } }])
    .toArray()
  return new Map(counts.map((entry) => [String(entry._id), entry.count]))
}

async function loadPerson(userId) {
  if (!isId(userId)) throw new HomeRowsError('Invalid userId')
  const user = await userQueries.findById(userId, USER_FIELDS)
  if (!user) throw new HomeRowsError('User not found', 404)
  return {
    id: String(user._id),
    objectId: new ObjectId(String(user._id)),
    name: displayName(user),
    email: user.email || '',
    isAdmin: isGlobalAdminUser(user),
  }
}

// Home-screen order, as userPlaylistSections.js sorts it: row order, then the
// playlist changed most recently. `playlistFor` finds a pref's playlist.
function homeScreenOrder(prefs, playlistFor) {
  return [...prefs].sort((a, b) => {
    const order = (a.appOrder ?? 0) - (b.appOrder ?? 0)
    if (order !== 0) return order
    return new Date(playlistFor(b)?.dateUpdated || 0) - new Date(playlistFor(a)?.dateUpdated || 0)
  })
}

function summarize(playlist, person, owners, counts) {
  const id = String(playlist._id)
  const ownerId = playlist.ownerId ? String(playlist.ownerId) : null
  return {
    id,
    name: playlist.name || 'Untitled playlist',
    ownerId,
    ownerName: sameId(ownerId, person.id) ? person.name : owners.get(ownerId) || 'Unknown user',
    itemCount: counts.get(id) || 0,
    privacy: playlist.privacy || 'private',
    relation: playlistRelation(playlist, person.id, person.isAdmin),
  }
}

function byRelationThenName(a, b) {
  return (
    RELATION_ORDER.indexOf(a.relation) - RELATION_ORDER.indexOf(b.relation) ||
    a.name.localeCompare(b.name) ||
    a.ownerName.localeCompare(b.ownerName)
  )
}

/**
 * A person's rows in home-screen order, and the playlists they could add:
 * the data behind the rows editor. Rows for a playlist they can no longer
 * open are left out, as the home page leaves them out.
 */
export async function getHomeRows(userId) {
  const person = await loadPerson(userId)
  const { playlists, watchlist, visibility } = await collections()
  const [open, prefs] = await Promise.all([
    playlistsOpenTo(playlists, person.objectId, person.isAdmin),
    visibility.find({ userId: person.objectId }).toArray(),
  ])
  const [owners, counts] = await Promise.all([
    nameMap(open.map((playlist) => playlist.ownerId).filter(Boolean)),
    itemCounts(watchlist, open.map((playlist) => playlist._id)),
  ])

  const openById = new Map(open.map((playlist) => [String(playlist._id), playlist]))
  const prefFor = new Map(prefs.map((pref) => [String(pref.playlistId), pref]))
  const shown = prefs.filter((pref) => pref.showInApp && openById.has(String(pref.playlistId)))

  const rows = homeScreenOrder(shown, (pref) => openById.get(String(pref.playlistId))).map((pref) => ({
    playlistId: String(pref.playlistId),
    appTitle: pref.appTitle || '',
    hideUnavailable: !!pref.hideUnavailable,
    playlist: summarize(openById.get(String(pref.playlistId)), person, owners, counts),
  }))
  const onHome = new Set(rows.map((row) => row.playlistId))
  const available = open
    .filter((playlist) => !onHome.has(String(playlist._id)))
    .map((playlist) => ({
      ...summarize(playlist, person, owners, counts),
      // Kept when a row is removed: the TV app reads it for the playlist too
      hideUnavailable: !!prefFor.get(String(playlist._id))?.hideUnavailable,
    }))
    .sort(byRelationThenName)

  return {
    person: { id: person.id, name: person.name, email: person.email, isAdmin: person.isAdmin },
    rows,
    available,
  }
}

/**
 * Replace a person's rows with `rows`, in order. Playlists left out stop
 * showing as rows but keep their "only what's in the library" choice.
 */
export async function saveHomeRows(userId, rows) {
  const person = await loadPerson(userId)
  const cleaned = cleanRows(rows)
  const { playlists, visibility } = await collections()

  const open = await playlistsOpenTo(playlists, person.objectId, person.isAdmin)
  const openIds = new Set(open.map((playlist) => String(playlist._id)))
  const blocked = cleaned.filter((row) => !openIds.has(row.playlistId))
  if (blocked.length > 0) {
    throw new HomeRowsError(`${person.name} can't open ${blocked.length === 1 ? 'one of these playlists' : `${blocked.length} of these playlists`}`, 403)
  }

  await ensurePlaylistVisibilityIndexes()
  const now = new Date()
  const listed = cleaned.map((row) => new ObjectId(row.playlistId))
  const writes = cleaned.map((row, index) => ({
    updateOne: {
      filter: { userId: person.objectId, playlistId: listed[index] },
      update: {
        $set: {
          showInApp: true,
          appOrder: index,
          appTitle: row.appTitle,
          hideUnavailable: row.hideUnavailable,
          dateUpdated: now,
        },
        $setOnInsert: { dateCreated: now },
      },
      upsert: true,
    },
  }))
  writes.push({
    updateMany: {
      filter: { userId: person.objectId, showInApp: true, playlistId: { $nin: listed } },
      update: { $set: { showInApp: false, dateUpdated: now } },
    },
  })
  await visibility.bulkWrite(writes, { ordered: true })
  return { rows: cleaned.length }
}

// The playlist and everyone, each with how they stand with it
async function audience(playlistId) {
  if (!isId(playlistId)) throw new HomeRowsError('Invalid playlistId')
  const { playlists } = await collections()
  const [playlist, users] = await Promise.all([
    playlists.findOne({ _id: new ObjectId(playlistId) }, { projection: PLAYLIST_FIELDS }),
    userQueries.findAll({}, USER_FIELDS),
  ])
  if (!playlist) throw new HomeRowsError('Playlist not found', 404)
  const people = users.map((user) => {
    const userId = String(user._id)
    const relation = playlistRelation(playlist, userId, isGlobalAdminUser(user))
    return { user, userId, relation, canOpen: relation !== null }
  })
  return { playlist, people }
}

// Each person's row number for the playlist, counting only the rows their
// home screen shows (rows for playlists they can open)
async function rowNumbers(visibility, playlists, targetPlaylistId, people) {
  const showingIds = people.map((person) => new ObjectId(person.userId))
  if (showingIds.length === 0) return new Map()
  const prefs = await visibility.find({ userId: { $in: showingIds }, showInApp: true }).toArray()
  const referenced = [...new Set(prefs.map((pref) => String(pref.playlistId)))].map((id) => new ObjectId(id))
  const docs = await playlists.find({ _id: { $in: referenced } }, { projection: PLAYLIST_FIELDS }).toArray()
  const playlistById = new Map(docs.map((doc) => [String(doc._id), doc]))
  const personById = new Map(people.map((person) => [person.userId, person]))

  const prefsByUser = new Map()
  for (const pref of prefs) {
    const userId = String(pref.userId)
    if (!prefsByUser.has(userId)) prefsByUser.set(userId, [])
    prefsByUser.get(userId).push(pref)
  }

  const numbers = new Map()
  for (const [userId, userPrefs] of prefsByUser) {
    const isAdmin = isGlobalAdminUser(personById.get(userId)?.user)
    const visible = userPrefs.filter((pref) => playlistRelation(playlistById.get(String(pref.playlistId)), userId, isAdmin) !== null)
    const ordered = homeScreenOrder(visible, (pref) => playlistById.get(String(pref.playlistId)))
    const index = ordered.findIndex((pref) => sameId(pref.playlistId, targetPlaylistId))
    if (index !== -1) numbers.set(userId, index + 1)
  }
  return numbers
}

const ROLE_BY_RELATION = { yours: 'owner', shared: 'collaborator', others: 'admin' }

/**
 * Everyone, with where one playlist stands on their home screen: the admin
 * "by playlist" view. People who can't open it are listed and marked, since
 * it can't be a row for them.
 */
export async function listHomeRowPeople(playlistId) {
  const { playlist, people } = await audience(playlistId)
  const { playlists, watchlist, visibility } = await collections()
  const [prefs, counts] = await Promise.all([
    visibility.find({ playlistId: playlist._id, showInApp: true }).toArray(),
    itemCounts(watchlist, [playlist._id]),
  ])
  const prefByUser = new Map(prefs.map((pref) => [String(pref.userId), pref]))
  const showing = people.filter((person) => person.canOpen && prefByUser.has(person.userId))
  const numbers = await rowNumbers(visibility, playlists, playlist._id, showing)

  const list = people
    .map((person) => {
      const pref = person.canOpen ? prefByUser.get(person.userId) : null
      return {
        userId: person.userId,
        name: displayName(person.user),
        email: person.user.email || '',
        canOpen: person.canOpen,
        role: ROLE_BY_RELATION[person.relation] || null,
        row: pref
          ? { position: numbers.get(person.userId) ?? null, appTitle: pref.appTitle || null, hideUnavailable: !!pref.hideUnavailable }
          : null,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email))

  const owner = people.find((person) => person.relation === 'yours')
  return {
    playlist: {
      id: String(playlist._id),
      name: playlist.name || 'Untitled playlist',
      ownerName: owner ? displayName(owner.user) : 'Unknown user',
      privacy: playlist.privacy || 'private',
      itemCount: counts.get(String(playlist._id)) || 0,
      collaboratorCount: playlist.collaborators?.length || 0,
    },
    people: list,
    counts: {
      all: list.length,
      showing: list.filter((person) => person.row).length,
      notShowing: list.filter((person) => person.canOpen && !person.row).length,
      noAccess: list.filter((person) => !person.canOpen).length,
    },
  }
}

/**
 * Everyone, with how many rows their home screen shows: the admin "by
 * person" list.
 */
export async function listPeopleWithRowCounts() {
  const { playlists, visibility } = await collections()
  const [users, prefs] = await Promise.all([
    userQueries.findAll({}, USER_FIELDS),
    visibility.find({ showInApp: true }, { projection: { userId: 1, playlistId: 1 } }).toArray(),
  ])
  const referenced = [...new Set(prefs.map((pref) => String(pref.playlistId)))].map((id) => new ObjectId(id))
  const docs = referenced.length
    ? await playlists.find({ _id: { $in: referenced } }, { projection: PLAYLIST_FIELDS }).toArray()
    : []
  const playlistById = new Map(docs.map((doc) => [String(doc._id), doc]))
  const adminById = new Map(users.map((user) => [String(user._id), isGlobalAdminUser(user)]))

  const rowCounts = new Map()
  for (const pref of prefs) {
    const userId = String(pref.userId)
    if (playlistRelation(playlistById.get(String(pref.playlistId)), userId, adminById.get(userId)) === null) continue
    rowCounts.set(userId, (rowCounts.get(userId) || 0) + 1)
  }

  return users
    .map((user) => ({
      userId: String(user._id),
      name: displayName(user),
      email: user.email || '',
      rowCount: rowCounts.get(String(user._id)) || 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email))
}

/**
 * Put a playlist on people's home screens as their first or last row.
 * `userIds` null means everyone who can open it. People who can't open it are
 * skipped; people who already have it keep their row where it is.
 * @returns {{ added: string[], alreadyShowing: number, skipped: number }}
 */
export async function addPlaylistToHomeScreens(playlistId, { userIds = null, position = 'top' } = {}) {
  if (position !== 'top' && position !== 'bottom') throw new HomeRowsError("position must be 'top' or 'bottom'")
  const requested = userIds === null ? null : new Set(cleanUserIds(userIds))
  const { playlist, people } = await audience(playlistId)
  const { visibility } = await collections()

  const targets = requested ? people.filter((person) => requested.has(person.userId)) : people
  const allowed = targets.filter((person) => person.canOpen)
  // Asked for but unable to open it, or not a known user
  const skipped = (requested ? requested.size : targets.length) - allowed.length

  const current = allowed.length
    ? await visibility
        .find(
          { playlistId: playlist._id, showInApp: true, userId: { $in: allowed.map((person) => new ObjectId(person.userId)) } },
          { projection: { userId: 1 } }
        )
        .toArray()
    : []
  const already = new Set(current.map((pref) => String(pref.userId)))
  const adding = allowed.filter((person) => !already.has(person.userId)).map((person) => person.userId)
  if (adding.length === 0) return { added: [], alreadyShowing: already.size, skipped }

  await ensurePlaylistVisibilityIndexes()
  const now = new Date()
  const addingIds = adding.map((id) => new ObjectId(id))
  let orderFor = () => 0
  if (position === 'top') {
    // Make room at the top of each person's rows
    await visibility.updateMany({ userId: { $in: addingIds }, showInApp: true }, { $inc: { appOrder: 1 } })
  } else {
    const lasts = await visibility
      .aggregate([{ $match: { userId: { $in: addingIds }, showInApp: true } }, { $group: { _id: '$userId', last: { $max: '$appOrder' } } }])
      .toArray()
    const lastBy = new Map(lasts.map((entry) => [String(entry._id), entry.last ?? -1]))
    orderFor = (id) => (lastBy.has(id) ? lastBy.get(id) + 1 : 0)
  }

  await visibility.bulkWrite(
    adding.map((id, index) => ({
      updateOne: {
        filter: { userId: addingIds[index], playlistId: playlist._id },
        update: {
          $set: { showInApp: true, appOrder: orderFor(id), dateUpdated: now },
          // A title or library choice from an earlier time on their home screen stays
          $setOnInsert: { appTitle: null, hideUnavailable: false, dateCreated: now },
        },
        upsert: true,
      },
    })),
    { ordered: false }
  )
  return { added: adding, alreadyShowing: already.size, skipped }
}

/**
 * Take a playlist off people's home screens; `userIds` null means everyone.
 * Their title and library choice are kept for if it comes back.
 * @returns {{ removed: string[] }}
 */
export async function removePlaylistFromHomeScreens(playlistId, { userIds = null } = {}) {
  if (!isId(playlistId)) throw new HomeRowsError('Invalid playlistId')
  const filter = { playlistId: new ObjectId(playlistId), showInApp: true }
  if (userIds !== null) filter.userId = { $in: cleanUserIds(userIds).map((id) => new ObjectId(id)) }

  const { visibility } = await collections()
  const showing = await visibility.find(filter, { projection: { userId: 1 } }).toArray()
  if (showing.length === 0) return { removed: [] }
  await visibility.updateMany(
    { _id: { $in: showing.map((pref) => pref._id) } },
    { $set: { showInApp: false, dateUpdated: new Date() } }
  )
  return { removed: showing.map((pref) => String(pref.userId)) }
}
