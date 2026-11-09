/**
 * The only reader of PlaybackPresence for "who is watching what right now".
 * Every surface (admin overview, media-activity API, transcoder sessions,
 * a user's own media pages) goes through here, so they all agree.
 * See plans/media-activity-presence.md.
 */

import clientPromise from '@src/lib/mongodb'
import { ObjectId } from 'mongodb'
import { createLogger } from '@src/lib/logger'
import { rankSessions, toLiveSession } from './session'

const log = createLogger('PlaybackPresence.Live')

// A safety bound, not a page size: live rows are a handful at a time.
const MAX_LIVE_SESSIONS = 500

function asObjectId(value) {
  if (value instanceof ObjectId) return value
  return new ObjectId(String(value))
}

/**
 * Live sessions, ranked (see rankSessions). Each filter is optional; an empty
 * filter list matches nothing rather than everything.
 *
 * @param {Object} [filters]
 * @param {Array<string|ObjectId>} [filters.userIds]
 * @param {Array<string>} [filters.mediaIds]
 * @param {Array<string|ObjectId>} [filters.showIds]
 * @param {Array<string>} [filters.normalizedVideoIds] - only for callers that know nothing else
 * @param {Object} [options]
 * @param {Date} [options.now]
 * @returns {Promise<Array<Object>>} LiveSessions
 */
export async function findLiveSessions(filters = {}, { now = new Date() } = {}) {
  const { userIds, mediaIds, showIds, normalizedVideoIds } = filters
  const lists = [userIds, mediaIds, showIds, normalizedVideoIds]
  if (lists.some((list) => Array.isArray(list) && list.length === 0)) return []

  const query = { staleAfter: { $gt: now } }
  if (userIds) query.userId = { $in: userIds.map(asObjectId) }
  if (mediaIds) query.mediaId = { $in: mediaIds }
  if (showIds) query.showId = { $in: showIds.map(asObjectId) }
  if (normalizedVideoIds) query.normalizedVideoId = { $in: normalizedVideoIds }

  const client = await clientPromise
  const rows = await client
    .db('Media')
    .collection('PlaybackPresence')
    .find(query)
    .limit(MAX_LIVE_SESSIONS)
    .toArray()

  const sessions = []
  for (const row of rows) {
    const session = toLiveSession(row)
    if (session) {
      sessions.push(session)
    } else {
      // Only the writer sets staleAfter, and it always sets state with it.
      log.warn({ rowId: String(row._id), state: row.state }, 'Live presence row has no known state — skipped')
    }
  }
  return rankSessions(sessions)
}
