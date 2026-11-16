import clientPromise from '@src/lib/mongodb'
import { ObjectId } from 'mongodb'
import { userQueries } from '@src/lib/userQueries'
import { forgetUserSessions } from '@src/lib/authSessionStore'
import { isAdminUser } from '@src/lib/roles/rules'
import { deletePlaybackForUser } from '@src/utils/watchHistory/database'
import { DELETION_REMINDER_DAYS, daysAfter, scheduledDeletionDate } from '@src/utils/deletionSchedule'
import { createLogger } from '@src/lib/logger'

const log = createLogger('AccountDeletion')

/**
 * Account deletion utility functions
 * Handles GDPR/CCPA compliant account deletion with audit logging
 */

const HEX_ID = /^[0-9a-fA-F]{24}$/

/** An id as an ObjectId, or null when it isn't one (missing, malformed, another type). */
function toObjectIdOrNull(value) {
  if (value instanceof ObjectId) return value
  if (typeof value === 'string' && HEX_ID.test(value)) return new ObjectId(value)
  // An ObjectId from another copy of the driver
  if (value && typeof value === 'object' && value._bsontype === 'ObjectId' && typeof value.toHexString === 'function') {
    return new ObjectId(value.toHexString())
  }
  return null
}

/**
 * A request that is still open: not started ('pending'), or started and not
 * finished ('processing'). A deletion runs from either; only one that has not
 * started can be cancelled.
 */
const OPEN_STATUSES = ['pending', 'processing']

/**
 * Create a deletion request for an authenticated user. It carries the date it
 * is carried out automatically (scheduledDeletionAt, DELETION_GRACE_DAYS from
 * now), by the server's hourly check (src/lib/scheduledDeletions.ts). Until
 * then the user can cancel it, and an admin can carry it out sooner.
 * @param {string} userId - User ID requesting deletion
 * @param {string} reason - Optional reason for deletion
 * @returns {Promise<Object>} Created deletion request
 */
export async function createAuthenticatedDeletionRequest(userId, reason = null) {
  const client = await clientPromise
  const db = client.db('Users')

  // Check if user exists
  const user = await userQueries.findById(userId)
  if (!user) {
    throw new Error('User not found')
  }

  // Check for existing open request
  const existingRequest = await db.collection('DeletionRequests').findOne({
    userId: new ObjectId(userId),
    status: { $in: OPEN_STATUSES }
  })

  if (existingRequest) {
    throw new Error('A deletion request is already pending for this user')
  }

  const now = new Date()
  const deletionRequest = {
    _id: new ObjectId(),
    userId: new ObjectId(userId),
    email: user.email,
    requestType: 'authenticated',
    status: 'pending',
    reason,
    requestedAt: now,
    scheduledDeletionAt: scheduledDeletionDate(now),
    createdAt: now,
    updatedAt: now
  }

  await db.collection('DeletionRequests').insertOne(deletionRequest)

  // Create audit log entry
  await createDeletionAuditLog({
    deletionRequestId: deletionRequest._id,
    action: 'request_created',
    performedBy: userId,
    details: { requestType: 'authenticated', reason }
  })

  return deletionRequest
}

/**
 * The account an email address belongs to, whatever its letters' case: the
 * sign-in providers report addresses in their own case, and the person typing
 * one into the public form need not match it.
 */
function findAccountByEmail(email) {
  return userQueries
    .collection()
    .findOne({ email }, { projection: { email: 1 }, collation: { locale: 'en', strength: 2 } })
}

/**
 * Record a deletion request made on the public form, by email address
 * (/privacy/delete-account): the way in for someone who cannot sign in.
 *
 * Nobody has proved they own the address: the app sends no mail, so there is
 * no link to click. The request therefore carries no date and is never
 * carried out automatically: it waits for an admin, is marked as coming from
 * the form (requestType 'public'), and the account's owner is told in the app
 * and can cancel it. The admin decides. Were it given a date, anyone could
 * delete someone else's account by typing their address and waiting.
 *
 * Returns null, and records nothing, when no account has the address or its
 * deletion is already requested. The route answers the same either way:
 * whether an address has an account is not this form's to tell.
 *
 * @param {string} email - The address typed into the form
 * @param {string|null} reason - Optional reason for deletion
 * @param {string|null} clientIp - Where the request came from, for the admin's record
 * @returns {Promise<Object|null>} The request recorded, or null
 */
export async function createPublicDeletionRequest(email, reason = null, clientIp = null) {
  if (typeof email !== 'string' || email.trim() === '') {
    throw new Error('A deletion request by email needs an email address')
  }

  const user = await findAccountByEmail(email.trim())
  if (!user) return null

  const client = await clientPromise
  const db = client.db('Users')

  const existingRequest = await db.collection('DeletionRequests').findOne({
    userId: user._id,
    status: { $in: OPEN_STATUSES }
  })
  if (existingRequest) return null

  const now = new Date()
  const deletionRequest = {
    _id: new ObjectId(),
    userId: user._id,
    // The account's own address, not the form's spelling of it
    email: user.email,
    requestType: 'public',
    status: 'pending',
    reason,
    requestedAt: now,
    metadata: { clientIp },
    createdAt: now,
    updatedAt: now
  }

  await db.collection('DeletionRequests').insertOne(deletionRequest)

  await createDeletionAuditLog({
    deletionRequestId: deletionRequest._id,
    action: 'public_request_created',
    performedBy: null,
    details: { requestType: 'public', reason },
    ipAddress: clientIp
  })

  return deletionRequest
}

/**
 * One deletion request by its id, or null when there is none (or the id isn't one).
 * @param {string|ObjectId} deletionRequestId - Deletion request ID
 * @returns {Promise<Object|null>} The request
 */
export async function getDeletionRequestById(deletionRequestId) {
  const _id = toObjectIdOrNull(deletionRequestId)
  if (!_id) return null
  const client = await clientPromise
  return client.db('Users').collection('DeletionRequests').findOne({ _id })
}

/**
 * The filters getDeletionRequests applies, and how each becomes a query. One
 * it doesn't know is refused: it used to be dropped, and a caller asking for
 * one request by id, or for one user's requests, got the newest request of
 * anyone's instead.
 */
const REQUEST_FILTERS = {
  status: (value) => value,
  requestType: (value) => value,
  email: (value) => ({ $regex: value, $options: 'i' }),
  _id: (value) => requireRequestFilterId('_id', value),
  userId: (value) => requireRequestFilterId('userId', value),
}

/** An id filter that is set must be an id: an unset one would match everyone's requests. */
function requireRequestFilterId(name, value) {
  const id = toObjectIdOrNull(value)
  if (!id) throw new Error(`getDeletionRequests: the ${name} filter needs a valid id`)
  return id
}

function deletionRequestQuery(filters) {
  const query = {}
  for (const [name, value] of Object.entries(filters)) {
    const toQuery = Object.hasOwn(REQUEST_FILTERS, name) ? REQUEST_FILTERS[name] : null
    if (!toQuery) throw new Error(`getDeletionRequests: no "${name}" filter`)
    // The ids fail closed (above); the others are optional, as the admin list passes them
    if (name === '_id' || name === 'userId') query[name] = toQuery(value)
    else if (value) query[name] = toQuery(value)
  }
  return query
}

/**
 * Get all deletion requests (admin function)
 * @param {Object} filters - Optional filters: status, requestType, email, _id, userId
 * @param {Object} pagination - Pagination options
 * @returns {Promise<Object>} Deletion requests with pagination info
 */
export async function getDeletionRequests(filters = {}, pagination = { page: 0, limit: 20 }) {
  // Before the database is touched: a filter that can't be applied is refused
  const query = deletionRequestQuery(filters)

  const client = await clientPromise
  const db = client.db('Users')

  const { page, limit } = pagination
  const skip = page * limit

  // Get total count
  const total = await db.collection('DeletionRequests').countDocuments(query)
  
  // Get requests with user data
  const requests = await db.collection('DeletionRequests').aggregate([
    { $match: query },
    { $sort: { requestedAt: -1 } },
    { $skip: skip },
    { $limit: limit },
    {
      $lookup: {
        from: 'user',
        localField: 'userId',
        foreignField: '_id',
        as: 'user'
      }
    },
    {
      $addFields: {
        user: { $arrayElemAt: ['$user', 0] }
      }
    }
  ]).toArray()
  
  return {
    requests,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: (page + 1) * limit < total
    }
  }
}

/**
 * Cancel a deletion request
 * @param {string} deletionRequestId - Deletion request ID
 * @param {string} performedBy - User ID performing the cancellation
 * @param {string} reason - Reason for cancellation
 * @returns {Promise<Object>} Updated deletion request
 */
export async function cancelDeletionRequest(deletionRequestId, performedBy, reason = null) {
  const requestId = toObjectIdOrNull(deletionRequestId)
  if (!requestId) {
    throw new Error('Deletion request not found or cannot be cancelled')
  }

  const client = await clientPromise
  const db = client.db('Users')

  const deletionRequest = await db.collection('DeletionRequests').findOneAndUpdate(
    {
      _id: requestId,
      // One that has not started: a deletion under way can only be finished
      status: 'pending'
    },
    { 
      $set: { 
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelledBy: performedBy,
        cancellationReason: reason,
        updatedAt: new Date()
      } 
    },
    { returnDocument: 'after' }
  )
  
  if (!deletionRequest) {
    throw new Error('Deletion request not found or cannot be cancelled')
  }
  
  // Create audit log entry
  await createDeletionAuditLog({
    deletionRequestId: requestId,
    action: 'request_cancelled',
    performedBy,
    details: { reason }
  })
  
  return deletionRequest
}

/** Where better-auth keeps user, session, account and deviceCode. */
const authDb = (client) => client.db(process.env.MONGODB_AUTH_DB || 'Users')

/** Why better-auth refuses a session to an account whose deletion has started. */
export const DELETION_BAN_REASON = 'Account deletion in progress'

const SUPERSEDED_REASON = 'The account was deleted by another request'

/**
 * The user a deletion acts on, as an ObjectId. Throws when the id is missing
 * or malformed: every filter a deletion runs is built from it, and a filter on
 * an undefined id matches the rows that have no user at all.
 */
function requireUserId(value) {
  const userId = toObjectIdOrNull(value)
  if (!userId) throw new Error('Account deletion needs a valid user id')
  return userId
}

// Each step is handed { client, userId, requestId, performedBy, removed, note }.
// `removed(name, count)` adds to the request's count for a collection as soon
// as its delete has finished, so a step that stops part-way has still counted
// what it removed; `note(name, value)` sets a result that is not a count.

/**
 * Step 1. The account stops acting before any of its data goes. It is banned,
 * so better-auth refuses it a new session (its admin plugin checks the flag
 * whenever a session is created: sign-in, a device code, "View as"), then
 * signed out everywhere. A deletion that stops after this leaves an account
 * that cannot sign in, with all its data, until the request is run again.
 *
 * session.userId is an ObjectId (it references user.id); a session's
 * impersonatedBy and a device code's userId are text.
 */
async function signOut({ client, userId, removed }) {
  const auth = authDb(client)
  const id = userId.toHexString()

  await userQueries.updateById(userId, { banned: true, banReason: DELETION_BAN_REASON, banExpires: null })

  // "View as" sessions this account opened as other users end with it
  const viewedAs = await auth.collection('session').distinct('userId', { impersonatedBy: id })
  await removed('session', (await auth.collection('session').deleteMany({ userId })).deletedCount)
  await removed('session', (await auth.collection('session').deleteMany({ impersonatedBy: id })).deletedCount)
  // A device code this account approved would hand a TV a session for it
  await removed('deviceCode', (await auth.collection('deviceCode').deleteMany({ userId: { $in: [id, userId] } })).deletedCount)

  // Only now that the rows are gone from Mongo: dropped any sooner, a request
  // racing the deletion could read the session from Mongo and cache it again
  await forgetUserSessions([userId, ...viewedAs])
}

/** Step 2. What the account watched, and what the app kept about it. */
async function deleteActivity({ client, userId, removed }) {
  const media = client.db('Media')

  await removed('WatchHistory', (await deletePlaybackForUser(userId)).deletedCount)
  // PlaybackStatus is what WatchHistory was migrated from: its rows would bring the history back
  for (const name of ['PlaybackStatus', 'PlaybackPresence', 'Notifications', 'ClientErrorReports']) {
    await removed(name, (await media.collection(name).deleteMany({ userId })).deletedCount)
  }
}

/** A list other people can open or change: it stays when its owner's account goes. */
const isSharedPlaylist = (playlist) =>
  playlist.privacy !== 'private' ||
  (Array.isArray(playlist.collaborators) && playlist.collaborators.length > 0) ||
  Boolean(playlist.globalPermission)

/**
 * Step 3. The account's lists. Its private lists go, with everything in them.
 * A list it owns that other people can open or change stays as it is, without
 * an owner, and is named in the results (keptSharedPlaylists): other people
 * use it, so removing it is not this deletion's call. On other people's lists
 * the account stops being a collaborator, and the titles it added stay: a
 * title belongs to its list, not to whoever added it.
 */
async function deleteLists({ client, userId, removed, note }) {
  const media = client.db('Media')
  const playlists = media.collection('Playlists')
  const watchlist = media.collection('Watchlist')

  const owned = await playlists
    .find({ ownerId: userId }, { projection: { _id: 1, privacy: 1, collaborators: 1, globalPermission: 1 } })
    .toArray()
  const own = owned.filter((playlist) => !isSharedPlaylist(playlist)).map((playlist) => playlist._id)
  await note('keptSharedPlaylists', owned.filter(isSharedPlaylist).map((playlist) => String(playlist._id)))

  if (own.length > 0) {
    // The items before their lists: a stop between the two leaves lists a second run still finds
    await removed('Watchlist', (await watchlist.deleteMany({ playlistId: { $in: own } })).deletedCount)
    await removed('Playlists', (await playlists.deleteMany({ _id: { $in: own }, ownerId: userId })).deletedCount)
  }

  // What it added that is in no list at all (the list has since gone)
  const listed = await watchlist.distinct('playlistId', { userId })
  const existing = await playlists.find({ _id: { $in: listed } }, { projection: { _id: 1 } }).toArray()
  await removed(
    'Watchlist',
    (await watchlist.deleteMany({ userId, playlistId: { $nin: existing.map((playlist) => playlist._id) } })).deletedCount
  )

  const collaborations = await playlists.updateMany(
    { collaborators: { $elemMatch: { userId } } },
    { $pull: { collaborators: { userId } } }
  )
  await removed('playlistCollaborations', collaborations.modifiedCount)

  await removed(
    'PlaylistVisibility',
    (await client.db('Users').collection('PlaylistVisibility').deleteMany({ userId })).deletedCount
  )
}

/**
 * The same person's rows under the names the sign-in system used before
 * better-auth (NextAuth), in a database that still has them: the old user and
 * OAuth account rows, the copies taken when they were migrated, and the QR
 * sign-in's tokens.
 */
const LEGACY_SIGN_IN = [
  ['AuthenticatedUsers', (userId) => ({ _id: userId })],
  ['AuthenticatedUsers_backup', (userId) => ({ _id: userId })],
  ['SSOAccounts', (userId) => ({ userId })],
  ['SSOAccounts_backup', (userId) => ({ userId })],
  ['authSessions', (userId) => ({ 'tokens.user.id': userId.toHexString() })],
  ['usedTokens', (userId) => ({ userId: userId.toHexString() })],
]

/** Step 4. */
async function deleteLegacySignIn({ client, userId, removed }) {
  const users = client.db('Users')
  for (const [name, filterFor] of LEGACY_SIGN_IN) {
    await removed(name, (await users.collection(name).deleteMany(filterFor(userId))).deletedCount)
  }
}

/** Step 5. The account's other deletion requests end here: this one deletes it. */
async function closeOtherRequests({ client, userId, requestId, performedBy, removed }) {
  const requests = client.db('Users').collection('DeletionRequests')

  const now = new Date()
  const superseded = await requests.updateMany(
    { userId, _id: { $ne: requestId }, status: { $in: OPEN_STATUSES } },
    {
      $set: {
        status: 'cancelled',
        cancelledAt: now,
        cancelledBy: performedBy,
        cancellationReason: SUPERSEDED_REASON,
        supersededBy: requestId,
        updatedAt: now,
      },
    }
  )
  await removed('supersededRequests', superseded.modifiedCount)
}

/**
 * Step 6, the last. The OAuth links, then the user. An account row left behind
 * would lock the person out for good: better-auth finds it at their next
 * sign-in, finds no user behind it, and refuses ("unable to link account")
 * rather than make a new one. The user row goes last of all, so that until
 * every other step has run the account is still listed on the Users page.
 */
async function deleteSignIn({ client, userId, removed }) {
  const auth = authDb(client)

  await removed('account', (await auth.collection('account').deleteMany({ userId })).deletedCount)
  // A session that was being created as step 1 ran
  await removed('session', (await auth.collection('session').deleteMany({ userId })).deletedCount)
  // Deletes the user, then drops its cached sessions
  await removed('user', (await userQueries.deleteById(userId)).deletedCount)
}

/**
 * A deletion's steps, in the order they run. The databases here are
 * standalone servers, which refuse transactions, so nothing spans the steps:
 * each is safe to run again, a run does all of them, and the request is
 * marked completed only after the last one. What a stop in each step leaves:
 *
 * - signOut:      the account banned, and signed out or not; all its data intact
 * - activity:     banned and signed out; some of its history and notifications gone
 * - lists:        as above, and some of its private lists and home rows gone
 * - legacySignIn: as above, and some of its pre-better-auth rows gone
 * - requests:     as above; other requests of the account may still be open
 * - account:      as above, and its OAuth links gone; the user row may remain
 *
 * In every case the request says "processing", names the step and the error
 * (lastError), counts what has been removed so far (deletionResults), and can
 * be run again.
 */
const DELETION_STEPS = [
  ['signOut', signOut],
  ['activity', deleteActivity],
  ['lists', deleteLists],
  ['legacySignIn', deleteLegacySignIn],
  ['requests', closeOtherRequests],
  ['account', deleteSignIn],
]

/**
 * How long a run holds its request before anyone else may run it. Each step
 * that finishes renews it, so it only has to outlast one step; a run whose
 * process died stops renewing, and the request is free again after this long.
 */
const RUN_LEASE_MS = 10 * 60 * 1000

const leaseFrom = (now) => new Date(now.getTime() + RUN_LEASE_MS)

/**
 * A deletion that was refused before anything was written or removed:
 * `reason` is 'not_found', 'not_open' (cancelled or completed), 'running'
 * (another run holds the request right now) or 'not_due' (the automatic run
 * was asked for a request it may not carry out).
 */
export class DeletionNotStarted extends Error {
  constructor(reason, message) {
    super(message)
    this.name = 'DeletionNotStarted'
    this.reason = reason
  }
}

const notFound = () => new DeletionNotStarted('not_found', 'Deletion request not found')
const notOpen = () => new DeletionNotStarted('not_open', 'Deletion request is not in pending status')

/**
 * Whether the automatic run may carry a request out now: one a user made
 * while signed in, whose date has come; or one the automatic run itself
 * started and did not finish. Never a request from the public form, whose
 * address nobody verified, and never one an admin started.
 */
function isDueForAutomaticRun(request, now) {
  if (request.status === 'processing') return request.lastRunAutomatic === true
  if (request.status !== 'pending' || request.requestType !== 'authenticated') return false
  if (!request.scheduledDeletionAt) return false
  const scheduled = new Date(request.scheduledDeletionAt)
  return !Number.isNaN(scheduled.getTime()) && scheduled <= now
}

/** What a run writes on its request as it goes. */
function progressOn(requests, requestId) {
  const write = (update) => requests.updateOne({ _id: requestId }, update)
  return {
    /** Adds to a collection's count: what earlier runs removed stays counted. */
    removed: (name, count) => write({ $inc: { [`deletionResults.${name}`]: count }, $set: { updatedAt: new Date() } }),
    note: (name, value) => write({ $set: { [`deletionResults.${name}`]: value, updatedAt: new Date() } }),
    /** A step of this run that ran to its end: the run keeps its hold on the request. */
    finished: (step) => {
      const now = new Date()
      return write({ $set: { [`progress.${step}`]: now, runLeaseUntil: leaseFrom(now), updatedAt: now } })
    },
  }
}

/**
 * The step a run stopped at, on the request and in the audit log, and the
 * request let go of so it can be run again. Never throws: the step's own error
 * is what the caller hears.
 */
async function recordFailure(requests, requestId, performedBy, step, error, automatic) {
  const message = error?.message || String(error)
  log.error({ requestId: String(requestId), step, automatic, error: message }, 'Account deletion stopped part-way; run the request again')
  try {
    const now = new Date()
    await requests.updateOne(
      { _id: requestId },
      {
        $set: { lastError: { step, message, at: now }, updatedAt: now },
        $unset: { runLeaseUntil: '' },
        // The automatic run gives up after MAX_AUTOMATIC_ATTEMPTS of these
        ...(automatic ? { $inc: { automaticFailures: 1 } } : {}),
      }
    )
    await createDeletionAuditLog({
      deletionRequestId: requestId,
      action: 'deletion_failed',
      performedBy,
      details: { step, error: message, ...(automatic ? { automatic: true } : {}) },
    })
  } catch (recordError) {
    log.error({ requestId: String(requestId), step, error: recordError?.message }, 'Could not record where the account deletion stopped')
  }
}

/**
 * Execute account deletion: every step, in order, without a transaction (see
 * DELETION_STEPS). The request moves to "processing" before the first step and
 * to "completed" only after the last. A request left in "processing" by a run
 * that stopped is run again with the same call, and finishes the job.
 *
 * One run at a time holds a request (runLeaseUntil): a second caller, an admin
 * clicking twice or the automatic check in another process, is refused with
 * DeletionNotStarted 'running' and removes nothing.
 *
 * @param {string|ObjectId} deletionRequestId - Deletion request ID
 * @param {string|ObjectId|null} performedBy - Admin user ID performing the deletion; null for the automatic run
 * @param {Object} [options]
 * @param {boolean} [options.automatic=false] - The server's own check is running it
 *   (src/lib/scheduledDeletions.ts), nobody is: allowed only for a request
 *   that is due (isDueForAutomaticRun), and recorded as such in the audit log
 * @returns {Promise<{ success: true, deletionResults: Object }>} What was removed, over every run of the request
 */
export async function executeAccountDeletion(deletionRequestId, performedBy, { automatic = false } = {}) {
  const requestId = toObjectIdOrNull(deletionRequestId)
  if (!requestId) {
    throw notFound()
  }
  // Who ran it goes in the audit log: refused here rather than half-way
  if (automatic) {
    if (performedBy != null) throw new Error('An automatic deletion is run by nobody: it takes no admin id')
  } else if (!toObjectIdOrNull(performedBy)) {
    throw new Error('Account deletion needs the id of the admin running it')
  }

  const client = await clientPromise
  const requests = client.db('Users').collection('DeletionRequests')

  const deletionRequest = await requests.findOne({ _id: requestId })
  if (!deletionRequest) {
    throw notFound()
  }
  if (!OPEN_STATUSES.includes(deletionRequest.status)) {
    throw notOpen()
  }

  const startedAt = new Date()
  if (automatic && !isDueForAutomaticRun(deletionRequest, startedAt)) {
    throw new DeletionNotStarted('not_due', 'Deletion request is not due to be carried out automatically')
  }

  // Before anything is written or removed
  const userId = requireUserId(deletionRequest.userId)
  const resumed = deletionRequest.status === 'processing'

  // Taken in one write: open, and held by no other run. A request cancelled
  // since it was read, or picked up by another run, does not match
  const started = await requests.updateOne(
    {
      _id: requestId,
      status: { $in: OPEN_STATUSES },
      $or: [{ runLeaseUntil: null }, { runLeaseUntil: { $lte: startedAt } }],
    },
    {
      $set: {
        status: 'processing',
        startedAt: deletionRequest.startedAt ?? startedAt,
        lastRunAt: startedAt,
        lastRunBy: performedBy,
        lastRunAutomatic: automatic,
        runLeaseUntil: leaseFrom(startedAt),
        // This run's steps; deletionResults keeps counting across runs
        progress: {},
        updatedAt: startedAt,
      },
      $unset: { lastError: '' },
    }
  )
  if (started.matchedCount !== 1) {
    const current = await requests.findOne({ _id: requestId })
    if (current && OPEN_STATUSES.includes(current.status)) {
      throw new DeletionNotStarted('running', 'This deletion is already running')
    }
    // Cancelled or completed since it was read
    throw notOpen()
  }

  const audited = automatic ? { automatic: true } : {}

  // 'start' is the audit entry: nothing is removed before it is written
  let step = 'start'
  try {
    await createDeletionAuditLog({
      deletionRequestId: requestId,
      action: resumed ? 'deletion_resumed' : 'deletion_started',
      performedBy,
      details: { userId: userId.toHexString(), ...audited },
    })
    const { removed, note, finished } = progressOn(requests, requestId)
    for (const [name, run] of DELETION_STEPS) {
      step = name
      await run({ client, userId, requestId, performedBy, removed, note })
      await finished(step)
    }
  } catch (error) {
    await recordFailure(requests, requestId, performedBy, step, error, automatic)
    throw error
  }

  // Every step ran
  const completedAt = new Date()
  const completed = await requests.updateOne(
    { _id: requestId, status: 'processing' },
    {
      $set: {
        status: 'completed',
        completedAt,
        completedBy: performedBy,
        completedAutomatically: automatic,
        updatedAt: completedAt,
      },
      $unset: { runLeaseUntil: '' },
    }
  )
  // What every run of the request removed, as the steps counted it
  const record = await requests.findOne({ _id: requestId })
  const deletionResults = record?.deletionResults ?? {}

  if (completed.modifiedCount === 1) {
    try {
      await createDeletionAuditLog({
        deletionRequestId: requestId,
        action: 'deletion_completed',
        performedBy,
        details: { deletionResults, ...audited },
      })
    } catch (auditError) {
      // The account is gone and the request says so; a lost log line is not a failed deletion
      log.error({ requestId: String(requestId), error: auditError?.message }, 'Account deleted, but the audit log entry could not be written')
    }
  }

  return { success: true, deletionResults }
}

/**
 * How many times the automatic check runs a deletion that keeps stopping
 * before it leaves the request to an admin (the Deletion Requests page's "Run
 * again"): one notification to the admins per attempt, not one an hour for ever.
 */
export const MAX_AUTOMATIC_ATTEMPTS = 5

/**
 * The requests the automatic check should carry out now, the ones it started
 * and did not finish first (their accounts are already signed out): what
 * isDueForAutomaticRun allows, and that no run holds at this moment.
 *
 * @param {Date} [now]
 * @param {number} [limit=10] - At most this many a check: the rest wait for the next
 * @returns {Promise<Array<Object>>} The requests
 */
export async function getDeletionsDueForAutomaticRun(now = new Date(), limit = 10) {
  const client = await clientPromise
  const requests = client.db('Users').collection('DeletionRequests')

  const stopped = await requests
    .find({
      status: 'processing',
      lastRunAutomatic: true,
      $or: [{ runLeaseUntil: null }, { runLeaseUntil: { $lte: now } }],
      // Missing counts as none: a run whose process died recorded no failure
      $nor: [{ automaticFailures: { $gte: MAX_AUTOMATIC_ATTEMPTS } }],
    })
    .sort({ lastRunAt: 1 })
    .limit(limit)
    .toArray()

  const due = await requests
    .find({ status: 'pending', requestType: 'authenticated', scheduledDeletionAt: { $lte: now } })
    .sort({ scheduledDeletionAt: 1 })
    .limit(limit)
    .toArray()

  return [...stopped, ...due].slice(0, limit)
}

/**
 * The requests whose account is due a reminder: a signed-in user's request,
 * still waiting, to be carried out within DELETION_REMINDER_DAYS. Each is
 * marked as reminded in the same write that finds it, so a request is handed
 * to one caller, once.
 *
 * @param {Date} [now]
 * @param {number} [limit=20]
 * @returns {Promise<Array<Object>>} The requests to remind
 */
export async function claimDeletionReminders(now = new Date(), limit = 20) {
  const client = await clientPromise
  const requests = client.db('Users').collection('DeletionRequests')

  const claimed = []
  while (claimed.length < limit) {
    const request = await requests.findOneAndUpdate(
      {
        status: 'pending',
        requestType: 'authenticated',
        scheduledDeletionAt: { $gt: now, $lte: daysAfter(now, DELETION_REMINDER_DAYS) },
        reminderSentAt: null,
      },
      { $set: { reminderSentAt: now, updatedAt: now } },
      { returnDocument: 'after' }
    )
    if (!request) break
    claimed.push(request)
  }
  return claimed
}

/** A deletion an admin asked for that is refused, with a code the route turns into a status. */
export class AccountDeletionRefusal extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AccountDeletionRefusal'
    this.code = code
  }
}

/**
 * A deletion an admin started that did not finish. Its request is on the
 * Deletion Requests page ("processing" once anything was removed), where it is
 * run again.
 */
export class AccountDeletionIncomplete extends Error {
  constructor(requestId, cause) {
    super('The deletion did not finish', { cause })
    this.name = 'AccountDeletionIncomplete'
    this.requestId = requestId
  }
}

const sameEmail = (typed, email) =>
  typeof typed === 'string' &&
  typeof email === 'string' &&
  email.trim() !== '' &&
  typed.trim().toLowerCase() === email.trim().toLowerCase()

/**
 * Delete an account that did not ask to be deleted, on an admin's decision
 * (the Users page). One pipeline with the deletions users ask for: this
 * records a request marked as the admin's (requestType 'admin', requestedBy)
 * and runs it at once, so the audit log names who did it, and a run that stops
 * shows on the Deletion Requests page to be run again. Nobody is notified.
 *
 * Refused with an AccountDeletionRefusal, before anything is written: an id
 * that isn't one, an account that doesn't exist, the admin's own account, an
 * admin's account, and a confirmation that is not the account's email.
 *
 * @param {Object} options
 * @param {string} options.userId - The account to delete
 * @param {string} options.adminId - The admin deleting it: the signed-in admin, never the request's word for it
 * @param {string} options.confirmEmail - The account's email, as the admin typed it
 * @param {string|null} [options.reason] - Why, for the record
 * @returns {Promise<{ requestId: string, deletionResults: Object }>}
 */
export async function deleteAccountAsAdmin({ userId, adminId, confirmEmail, reason = null }) {
  const targetId = toObjectIdOrNull(userId)
  if (!targetId) {
    throw new AccountDeletionRefusal('INVALID_USER_ID', 'A valid user id is required.')
  }
  const adminObjectId = toObjectIdOrNull(adminId)
  if (!adminObjectId) {
    throw new Error('Account deletion needs the id of the admin running it')
  }
  if (targetId.equals(adminObjectId)) {
    throw new AccountDeletionRefusal('OWN_ACCOUNT', 'You can’t delete your own account here.')
  }

  const user = await userQueries.findById(targetId, { email: 1, role: 1 })
  if (!user) {
    throw new AccountDeletionRefusal('USER_NOT_FOUND', 'No account has that id.')
  }
  if (isAdminUser(user)) {
    throw new AccountDeletionRefusal('TARGET_IS_ADMIN', 'An admin’s account can’t be deleted here.')
  }
  if (!sameEmail(confirmEmail, user.email)) {
    throw new AccountDeletionRefusal('EMAIL_MISMATCH', 'The email typed is not this account’s email.')
  }

  const client = await clientPromise
  const now = new Date()
  const deletionRequest = {
    _id: new ObjectId(),
    userId: targetId,
    email: user.email,
    requestType: 'admin',
    status: 'pending',
    reason,
    requestedBy: adminObjectId,
    requestedAt: now,
    createdAt: now,
    updatedAt: now,
  }
  await client.db('Users').collection('DeletionRequests').insertOne(deletionRequest)
  const requestId = deletionRequest._id.toHexString()

  // From here the request exists: whatever stops, it is there to be run again
  try {
    await createDeletionAuditLog({
      deletionRequestId: deletionRequest._id,
      action: 'admin_request_created',
      performedBy: adminObjectId,
      details: { requestType: 'admin', reason, userId: targetId.toHexString() },
    })
    const { deletionResults } = await executeAccountDeletion(requestId, adminObjectId.toHexString())
    return { requestId, deletionResults }
  } catch (error) {
    throw new AccountDeletionIncomplete(requestId, error)
  }
}

/**
 * Create an audit log entry for deletion actions
 * @param {Object} logData - Audit log data
 * @returns {Promise<Object>} Created audit log entry
 */
export async function createDeletionAuditLog(logData) {
  const client = await clientPromise
  const db = client.db('Users')

  const auditLog = {
    _id: new ObjectId(),
    deletionRequestId: logData.deletionRequestId,
    action: logData.action,
    performedBy: logData.performedBy ? new ObjectId(logData.performedBy) : null,
    performedAt: new Date(),
    details: logData.details || {},
    ipAddress: logData.ipAddress || null,
    userAgent: logData.userAgent || null
  }

  await db.collection('DeletionAuditLog').insertOne(auditLog)

  return auditLog
}

/**
 * Get deletion audit logs for a specific request
 * @param {string} deletionRequestId - Deletion request ID
 * @returns {Promise<Array>} Audit log entries
 */
export async function getDeletionAuditLogs(deletionRequestId) {
  const client = await clientPromise
  const db = client.db('Users')
  
  const logs = await db.collection('DeletionAuditLog').aggregate([
    { $match: { deletionRequestId: new ObjectId(deletionRequestId) } },
    { $sort: { performedAt: 1 } },
    {
      $lookup: {
        from: 'user',
        localField: 'performedBy',
        foreignField: '_id',
        as: 'performer'
      }
    },
    {
      $addFields: {
        performer: { $arrayElemAt: ['$performer', 0] }
      }
    }
  ]).toArray()
  
  return logs
}
