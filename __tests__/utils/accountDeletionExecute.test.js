/**
 * @jest-environment node
 *
 * executeAccountDeletion, run for real over an in-memory database: the
 * collections it removes an account from, what it leaves alone, and what a
 * run that stops part-way leaves behind.
 *
 * Only the database, Redis and the logger are faked. The module's own imports
 * are the real ones (the playback delete among them: it was once called
 * without being imported, and no test ran the line).
 *
 * The databases this runs on are standalone servers, which refuse
 * transactions, so the deletion is a fixed sequence of steps, each safe to run
 * again, and the request records how far it got.
 */

const { createMemoryMongo } = require('../helpers/memoryMongo')

const mockMongo = createMemoryMongo()
jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve(mockMongo.client),
  mongoClient: mockMongo.client,
}))

const mockForget = jest.fn()
jest.mock('@src/lib/authSessionStore', () => ({ forgetUserSessions: (...args) => mockForget(...args) }))
const mockLog = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('@src/lib/logger', () => ({ __esModule: true, createLogger: () => mockLog }))

const { ObjectId } = require('mongodb')
const { executeAccountDeletion, DELETION_BAN_REASON } = require('@src/utils/accountDeletion')
const { deletePlaybackForUser } = require('@src/utils/watchHistory/database')

const ADMIN = '507f1f77bcf86cd7994390ad'
const ADA = '507f1f77bcf86cd799439011' // the account being deleted
const GRACE = '507f1f77bcf86cd799439022' // someone else
const REQUEST = '64b7f0c2a1b2c3d4e5f60001'

const LIST = {
  adaPrivate: '64b7f0c2a1b2c3d4e5f6a001',
  adaPublic: '64b7f0c2a1b2c3d4e5f6a002',
  adaWithCollaborator: '64b7f0c2a1b2c3d4e5f6a003',
  adaOpenToAll: '64b7f0c2a1b2c3d4e5f6a004',
  graceShared: '64b7f0c2a1b2c3d4e5f6b001',
  gone: '64b7f0c2a1b2c3d4e5f6dead',
}

const oid = (hex) => new ObjectId(hex)
const col = (db, name) => mockMongo.collection(db, name)
const docsOf = (db, name, field, hex) => col(db, name).docs.filter((doc) => doc[field] === hex)
const request = (id = REQUEST) => col('Users', 'DeletionRequests').docs.find((doc) => doc._id === id)
const auditActions = () => col('Users', 'DeletionAuditLog').docs.map((doc) => doc.action)

/** Every collection the deletion touches, by database: emptied before each test. */
const COLLECTIONS = {
  Users: [
    'user', 'session', 'account', 'deviceCode', 'PlaylistVisibility', 'DeletionRequests', 'DeletionAuditLog',
    'AuthenticatedUsers', 'AuthenticatedUsers_backup', 'SSOAccounts', 'SSOAccounts_backup',
    'authSessions', 'usedTokens',
  ],
  Media: ['WatchHistory', 'PlaybackStatus', 'PlaybackPresence', 'Notifications', 'ClientErrorReports', 'ArrRequests', 'Playlists', 'Watchlist'],
}

/** What each collection holds per user, as { field, value } to count by. */
const USER_KEYED = [
  ['Users', 'session', 'userId'],
  ['Users', 'account', 'userId'],
  ['Users', 'deviceCode', 'userId'],
  ['Users', 'PlaylistVisibility', 'userId'],
  ['Users', 'AuthenticatedUsers', '_id'],
  ['Users', 'AuthenticatedUsers_backup', '_id'],
  ['Users', 'SSOAccounts', 'userId'],
  ['Users', 'SSOAccounts_backup', 'userId'],
  ['Users', 'usedTokens', 'userId'],
  ['Users', 'user', '_id'],
  ['Media', 'WatchHistory', 'userId'],
  ['Media', 'PlaybackStatus', 'userId'],
  ['Media', 'PlaybackPresence', 'userId'],
  ['Media', 'Notifications', 'userId'],
  ['Media', 'ClientErrorReports', 'userId'],
]

/** Rows of both users in every collection, plus rows that have no user at all. */
function seed({ requestOverrides = {} } = {}) {
  for (const [db, names] of Object.entries(COLLECTIONS)) for (const name of names) col(db, name).docs = []

  for (const [hex, email, role] of [[ADA, 'ada@example.invalid', 'user'], [GRACE, 'grace@example.invalid', 'user'], [ADMIN, 'admin@example.invalid', 'admin']]) {
    col('Users', 'user').insertOne({ _id: oid(hex), email, name: email, role, approved: true })
  }

  for (const hex of [ADA, GRACE]) {
    const userId = oid(hex)
    col('Users', 'session').insertOne({ userId, token: `tok-${hex}-1` })
    col('Users', 'session').insertOne({ userId, token: `tok-${hex}-2` })
    col('Users', 'account').insertOne({ userId, providerId: 'google', accountId: `g-${hex}` })
    col('Users', 'deviceCode').insertOne({ userId: hex, status: 'approved', deviceCode: `d-${hex}`, userCode: `u-${hex}` })
    col('Users', 'PlaylistVisibility').insertOne({ userId, playlistId: oid(LIST.graceShared), showInApp: true })
    col('Users', 'AuthenticatedUsers').insertOne({ _id: userId, email: `${hex}@example.invalid` })
    col('Users', 'AuthenticatedUsers_backup').insertOne({ _id: userId, email: `${hex}@example.invalid` })
    col('Users', 'SSOAccounts').insertOne({ userId, provider: 'google' })
    col('Users', 'SSOAccounts_backup').insertOne({ userId, provider: 'google' })
    col('Users', 'authSessions').insertOne({ tokens: { user: { id: hex } } })
    col('Users', 'usedTokens').insertOne({ userId: hex })

    col('Media', 'WatchHistory').insertOne({ userId, normalizedVideoId: 'nid-1', playbackTime: 10 })
    col('Media', 'WatchHistory').insertOne({ userId, normalizedVideoId: 'nid-2', playbackTime: 20 })
    col('Media', 'WatchHistory').insertOne({ userId, normalizedVideoId: 'nid-3', playbackTime: 30 })
    col('Media', 'PlaybackStatus').insertOne({ userId, videosWatched: [] })
    col('Media', 'PlaybackPresence').insertOne({ userId, sessionId: `s-${hex}` })
    col('Media', 'Notifications').insertOne({ userId, title: 'one' })
    col('Media', 'Notifications').insertOne({ userId, title: 'two' })
    col('Media', 'ClientErrorReports').insertOne({ userId, userEmail: `${hex}@example.invalid` })
    col('Media', 'ArrRequests').insertOne({ userId: hex, userName: hex, kind: 'add' })
  }

  // Ada opened a "View as" session as Grace
  col('Users', 'session').insertOne({ userId: oid(GRACE), token: 'tok-view-as', impersonatedBy: ADA })

  // Rows with no user: what a filter on a missing id would match
  for (const [db, name] of [['Users', 'session'], ['Users', 'account'], ['Media', 'WatchHistory'], ['Media', 'Notifications'], ['Media', 'Watchlist']]) {
    col(db, name).insertOne({ note: 'no user' })
  }

  const playlist = (hex, owner, extra) =>
    col('Media', 'Playlists').insertOne({ _id: oid(hex), ownerId: oid(owner), privacy: 'private', collaborators: [], ...extra })
  playlist(LIST.adaPrivate, ADA, { isDefault: true })
  playlist(LIST.adaPublic, ADA, { privacy: 'public' })
  playlist(LIST.adaWithCollaborator, ADA, { collaborators: [{ userId: oid(GRACE), permission: 'add' }] })
  playlist(LIST.adaOpenToAll, ADA, { privacy: 'shared', globalPermission: 'admin' })
  playlist(LIST.graceShared, GRACE, { collaborators: [{ userId: oid(ADA), permission: 'edit' }, { userId: oid(ADMIN), permission: 'view' }] })

  const item = (list, adder, tmdbId) =>
    col('Media', 'Watchlist').insertOne({ playlistId: oid(list), userId: oid(adder), tmdbId, mediaType: 'movie' })
  item(LIST.adaPrivate, ADA, 1)
  item(LIST.adaPrivate, ADA, 2)
  item(LIST.adaPrivate, ADMIN, 3) // an admin put it in her private list: it goes with the list
  item(LIST.adaPublic, ADA, 4)
  item(LIST.adaPublic, GRACE, 5)
  item(LIST.adaWithCollaborator, ADA, 6)
  item(LIST.graceShared, ADA, 7) // she added it to Grace's list: it is the list's
  item(LIST.graceShared, GRACE, 8)
  item(LIST.gone, ADA, 9) // in a list that no longer exists
  item(LIST.gone, GRACE, 10)

  col('Users', 'DeletionRequests').insertOne({
    _id: oid(REQUEST),
    userId: oid(ADA),
    email: 'ada@example.invalid',
    requestType: 'authenticated',
    status: 'pending',
    ...requestOverrides,
  })
}

/** How many rows each user has in each collection, and how many belong to nobody. */
function census() {
  const counts = {}
  for (const [db, name, field] of USER_KEYED) {
    // A "View as" session is its admin's, whoever it is a session as
    const docs = col(db, name).docs.filter((doc) => !doc.impersonatedBy)
    counts[`${db}.${name}`] = {
      ada: docs.filter((doc) => doc[field] === ADA).length,
      grace: docs.filter((doc) => doc[field] === GRACE).length,
      nobody: docs.filter((doc) => doc[field] === undefined).length,
    }
  }
  return counts
}

const snapshot = () =>
  JSON.stringify(Object.entries(COLLECTIONS).map(([db, names]) => names.filter((name) => !name.startsWith('Deletion')).map((name) => col(db, name).docs)))

/** Makes one call of a collection method throw, then puts the method back. */
function failOnce(db, name, method, message) {
  const collection = col(db, name)
  const original = collection[method]
  collection[method] = () => {
    collection[method] = original
    throw new Error(message)
  }
  return () => {
    collection[method] = original
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockForget.mockResolvedValue(undefined)
  seed()
})

describe('a deletion that runs to the end', () => {
  test('removes the account’s rows, leaves everyone else’s, and answers with what it removed', async () => {
    const before = census()

    const result = await executeAccountDeletion(REQUEST, ADMIN)

    const after = census()
    for (const [name, counts] of Object.entries(after)) {
      expect([name, counts.ada]).toEqual([name, 0])
      expect([name, counts.grace]).toEqual([name, before[name].grace])
      expect([name, counts.nobody]).toEqual([name, before[name].nobody])
    }
    // The QR sign-in's old tokens are keyed inside the document
    expect(col('Users', 'authSessions').docs.map((doc) => doc.tokens.user.id)).toEqual([GRACE])

    expect(result).toEqual({
      success: true,
      deletionResults: {
        session: 3, // her two, and the one she opened as Grace
        deviceCode: 1,
        WatchHistory: 3,
        PlaybackStatus: 1,
        PlaybackPresence: 1,
        Notifications: 2,
        ClientErrorReports: 1,
        Playlists: 1,
        Watchlist: 4,
        playlistCollaborations: 1,
        PlaylistVisibility: 1,
        keptSharedPlaylists: [LIST.adaPublic, LIST.adaWithCollaborator, LIST.adaOpenToAll],
        AuthenticatedUsers: 1,
        AuthenticatedUsers_backup: 1,
        SSOAccounts: 1,
        SSOAccounts_backup: 1,
        authSessions: 1,
        usedTokens: 1,
        supersededRequests: 0,
        account: 1,
        user: 1,
      },
    })
  })

  test('marks the request completed, by the admin, with the same counts', async () => {
    const { deletionResults } = await executeAccountDeletion(REQUEST, ADMIN)

    expect(request()).toMatchObject({
      status: 'completed',
      completedBy: ADMIN,
      lastRunBy: ADMIN,
      deletionResults,
      progress: {
        signOut: expect.any(String),
        activity: expect.any(String),
        lists: expect.any(String),
        legacySignIn: expect.any(String),
        requests: expect.any(String),
        account: expect.any(String),
      },
    })
    expect(request().lastError).toBeUndefined()
    expect(auditActions()).toEqual(['deletion_started', 'deletion_completed'])
    expect(col('Users', 'DeletionAuditLog').docs.every((entry) => entry.performedBy === ADMIN)).toBe(true)
  })

  test('the playback rows go through the real deletePlaybackForUser', async () => {
    await executeAccountDeletion(REQUEST, ADMIN)

    expect(docsOf('Media', 'WatchHistory', 'userId', ADA)).toEqual([])
    expect(mockLog.info).toHaveBeenCalledWith({ userId: ADA, deletedCount: 3 }, 'Deleted playback for user')
  })

  test('keeps the lists other people use, and what belongs to other people’s lists', async () => {
    await executeAccountDeletion(REQUEST, ADMIN)

    const lists = col('Media', 'Playlists').docs
    expect(lists.map((list) => list._id).sort()).toEqual(
      [LIST.adaPublic, LIST.adaWithCollaborator, LIST.adaOpenToAll, LIST.graceShared].sort()
    )
    // Still hers by id: nobody was made its owner
    expect(lists.find((list) => list._id === LIST.adaPublic).ownerId).toBe(ADA)
    // She is no longer a collaborator on Grace's list; the other collaborator is
    expect(lists.find((list) => list._id === LIST.graceShared).collaborators).toEqual([{ userId: ADMIN, permission: 'view' }])
    // Grace is still a collaborator on the list of hers that stays
    expect(lists.find((list) => list._id === LIST.adaWithCollaborator).collaborators).toEqual([{ userId: GRACE, permission: 'add' }])

    const titles = col('Media', 'Watchlist').docs.filter((doc) => doc.tmdbId).map((doc) => doc.tmdbId).sort((a, b) => a - b)
    // Gone: her private list's three (the admin's among them) and her title in a list that no longer exists
    expect(titles).toEqual([4, 5, 6, 7, 8, 10])
  })

  test('leaves the Radarr/Sonarr activity log alone', async () => {
    await executeAccountDeletion(REQUEST, ADMIN)

    expect(col('Media', 'ArrRequests').docs.map((doc) => doc.userId).sort()).toEqual([ADA, GRACE].sort())
  })

  test('closes the account’s other open requests, and nobody else’s', async () => {
    // One made on the public form while this one waited
    const other = '64b7f0c2a1b2c3d4e5f60002'
    const graces = '64b7f0c2a1b2c3d4e5f60003'
    const old = '64b7f0c2a1b2c3d4e5f60004'
    col('Users', 'DeletionRequests').insertOne({ _id: oid(other), userId: oid(ADA), email: 'ada@example.invalid', requestType: 'public', status: 'pending' })
    col('Users', 'DeletionRequests').insertOne({ _id: oid(graces), userId: oid(GRACE), email: 'grace@example.invalid', status: 'pending' })
    col('Users', 'DeletionRequests').insertOne({ _id: oid(old), userId: oid(ADA), email: 'ada@example.invalid', status: 'cancelled', cancellationReason: 'Cancelled by user' })

    const { deletionResults } = await executeAccountDeletion(REQUEST, ADMIN)

    expect(request(other)).toMatchObject({ status: 'cancelled', supersededBy: REQUEST, cancelledBy: ADMIN })
    expect(request(graces).status).toBe('pending')
    // One she cancelled herself keeps its own reason
    expect(request(old)).toMatchObject({ status: 'cancelled', cancellationReason: 'Cancelled by user' })
    expect(deletionResults).toMatchObject({ supersededRequests: 1 })
  })
})

describe('the order of a deletion', () => {
  /** Every write, as `collection.method`, in the order made. */
  function traceWrites() {
    const writes = []
    for (const [db, names] of Object.entries(COLLECTIONS)) {
      for (const name of names) {
        if (name.startsWith('Deletion')) continue
        const collection = col(db, name)
        for (const method of ['deleteMany', 'deleteOne', 'updateMany', 'updateOne']) {
          const original = collection[method]
          jest.spyOn(collection, method).mockImplementation((...args) => {
            writes.push(`${name}.${method}`)
            return original(...args)
          })
        }
      }
    }
    return writes
  }

  afterEach(() => jest.restoreAllMocks())

  test('the account is stopped first and its user row goes last', async () => {
    const writes = traceWrites()

    await executeAccountDeletion(REQUEST, ADMIN)

    expect(writes).toEqual([
      'user.updateOne', // banned
      'session.deleteMany',
      'session.deleteMany', // the sessions it opened as other users
      'deviceCode.deleteMany',
      'WatchHistory.deleteMany',
      'PlaybackStatus.deleteMany',
      'PlaybackPresence.deleteMany',
      'Notifications.deleteMany',
      'ClientErrorReports.deleteMany',
      'Watchlist.deleteMany', // its private lists' titles, before the lists
      'Playlists.deleteMany',
      'Watchlist.deleteMany', // its titles in no list
      'Playlists.updateMany', // no longer a collaborator
      'PlaylistVisibility.deleteMany',
      'AuthenticatedUsers.deleteMany',
      'AuthenticatedUsers_backup.deleteMany',
      'SSOAccounts.deleteMany',
      'SSOAccounts_backup.deleteMany',
      'authSessions.deleteMany',
      'usedTokens.deleteMany',
      'account.deleteMany',
      'session.deleteMany',
      'user.deleteOne',
    ])
  })

  test('it is banned before its sessions go, so it cannot sign back in part-way', async () => {
    let bannedWhenSessionsWent = null
    const sessions = col('Users', 'session')
    const deleteMany = sessions.deleteMany
    jest.spyOn(sessions, 'deleteMany').mockImplementation((...args) => {
      bannedWhenSessionsWent ??= col('Users', 'user').docs.find((doc) => doc._id === ADA).banned
      return deleteMany(...args)
    })

    await executeAccountDeletion(REQUEST, ADMIN)

    expect(bannedWhenSessionsWent).toBe(true)
  })

  test('cached sessions are dropped only once the session rows are gone from Mongo', async () => {
    const sessionRowsAtForget = []
    mockForget.mockImplementation(async (ids) => {
      const forgotten = (Array.isArray(ids) ? ids : [ids]).map(String)
      sessionRowsAtForget.push({ forgotten, rows: docsOf('Users', 'session', 'userId', ADA).length })
    })

    await executeAccountDeletion(REQUEST, ADMIN)

    // The first is the ban (a write to the user, through userQueries); the
    // sign-out's own comes after its deletes, and names whoever she was viewing as
    const signOut = sessionRowsAtForget.find((call) => call.forgotten.includes(GRACE))
    expect(signOut).toEqual({ forgotten: [ADA, GRACE], rows: 0 })
    expect(sessionRowsAtForget.at(-1)).toEqual({ forgotten: [ADA], rows: 0 })
    expect(sessionRowsAtForget.filter((call) => call.rows > 0)).toHaveLength(1)
  })
})

describe('a deletion without a usable user id', () => {
  test.each([
    ['missing', { userId: undefined }],
    ['null', { userId: null }],
    ['empty', { userId: '' }],
    ['malformed', { userId: 'ada' }],
    ['an object', { userId: { $ne: null } }],
  ])('refuses a request whose user id is %s, and removes nothing', async (_label, requestOverrides) => {
    seed({ requestOverrides })
    const before = snapshot()

    await expect(executeAccountDeletion(REQUEST, ADMIN)).rejects.toThrow('Account deletion needs a valid user id')

    expect(snapshot()).toBe(before)
    expect(request().status).toBe('pending')
    expect(auditActions()).toEqual([])
    expect(mockForget).not.toHaveBeenCalled()
  })

  test('deletePlaybackForUser refuses a missing id instead of matching the rows that have no user', async () => {
    const before = col('Media', 'WatchHistory').docs.length

    for (const userId of [undefined, null, {}, 42]) {
      await expect(deletePlaybackForUser(userId)).rejects.toThrow('deletePlaybackForUser needs a user id')
    }

    expect(col('Media', 'WatchHistory').docs).toHaveLength(before)
  })

  test('refuses to run without the id of the admin running it', async () => {
    const before = snapshot()

    for (const performedBy of [undefined, null, 'system', '']) {
      await expect(executeAccountDeletion(REQUEST, performedBy)).rejects.toThrow('needs the id of the admin')
    }

    expect(snapshot()).toBe(before)
    expect(request().status).toBe('pending')
  })
})

describe('a request that cannot be run', () => {
  test.each(['completed', 'cancelled'])('a %s request is refused and nothing is removed', async (status) => {
    seed({ requestOverrides: { status } })
    const before = snapshot()

    await expect(executeAccountDeletion(REQUEST, ADMIN)).rejects.toThrow('Deletion request is not in pending status')

    expect(snapshot()).toBe(before)
    expect(request().status).toBe(status)
  })

  test('an id no request has is "not found"', async () => {
    for (const id of ['64b7f0c2a1b2c3d4e5f6ffff', 'nope', undefined]) {
      await expect(executeAccountDeletion(id, ADMIN)).rejects.toThrow('Deletion request not found')
    }
  })
})

describe('a deletion that stops part-way', () => {
  // One write of each step, made to fail once
  const STOPS = [
    ['signOut', 'Users', 'session', 'deleteMany'],
    ['activity', 'Media', 'Notifications', 'deleteMany'],
    ['lists', 'Media', 'Playlists', 'updateMany'],
    ['legacySignIn', 'Users', 'SSOAccounts', 'deleteMany'],
    ['requests', 'Users', 'DeletionRequests', 'updateMany'],
    ['account', 'Users', 'user', 'deleteOne'],
  ]

  test.each(STOPS)('stopped in %s: the request says where, is not completed, and a second run finishes it', async (step, db, name, method) => {
    const clean = (await executeAccountDeletion(REQUEST, ADMIN)).deletionResults
    seed()
    const graceBefore = Object.fromEntries(Object.entries(census()).map(([key, counts]) => [key, counts.grace]))
    const restore = failOnce(db, name, method, `${name} is unavailable`)

    await expect(executeAccountDeletion(REQUEST, ADMIN)).rejects.toThrow(`${name} is unavailable`)
    restore()

    expect(request()).toMatchObject({
      status: 'processing',
      lastError: { step, message: `${name} is unavailable` },
    })
    expect(request().completedAt).toBeUndefined()
    expect(request().progress[step]).toBeUndefined()
    expect(auditActions()).toEqual(['deletion_started', 'deletion_failed'])
    // Stopped accounts cannot sign in: banned for as long as the user row is there
    const user = col('Users', 'user').docs.find((doc) => doc._id === ADA)
    expect(user).toMatchObject({ banned: true, banReason: DELETION_BAN_REASON })

    const result = await executeAccountDeletion(REQUEST, ADMIN)

    expect(request()).toMatchObject({ status: 'completed', completedBy: ADMIN })
    expect(request().lastError).toBeUndefined()
    expect(auditActions()).toEqual(['deletion_started', 'deletion_failed', 'deletion_resumed', 'deletion_completed'])
    // Both runs together removed exactly what one clean run removes
    expect(result.deletionResults).toEqual(clean)
    for (const [key, counts] of Object.entries(census())) {
      expect([key, counts.ada]).toEqual([key, 0])
      expect([key, counts.grace]).toEqual([key, graceBefore[key]])
    }
  })

  test('stopped before the first step (the audit entry could not be written): nothing is removed', async () => {
    const restore = failOnce('Users', 'DeletionAuditLog', 'insertOne', 'audit log is unavailable')
    const before = snapshot()

    await expect(executeAccountDeletion(REQUEST, ADMIN)).rejects.toThrow('audit log is unavailable')
    restore()

    expect(snapshot()).toBe(before)
    expect(request()).toMatchObject({ status: 'processing', lastError: { step: 'start' } })
  })

  test('a completed request is not run a second time', async () => {
    await executeAccountDeletion(REQUEST, ADMIN)

    await expect(executeAccountDeletion(REQUEST, ADMIN)).rejects.toThrow('Deletion request is not in pending status')
    expect(auditActions()).toEqual(['deletion_started', 'deletion_completed'])
  })
})
