/**
 * A viewer's recent positions, as one snapshot: what
 * GET /api/authenticated/sync/positions answers with.
 *
 * It holds what a page needs to draw progress on the titles it shows, and no
 * more: the two keys a title is found by, the position, and when the row was
 * last written. Not the video URL, the device or the addresses a row also
 * carries.
 *
 * The window is the recent past, cut in MongoDB on the {userId, lastUpdated}
 * index: a history of thousands of rows costs the same read as one of ten. A
 * title outside the window is asked for by itself
 * (GET /api/authenticated/sync/playback).
 */

import { findPlaybackForUser } from '@src/utils/watchHistory/database'
import { watchRowsInScope } from '@src/utils/watchHistory/scopeRows'
import { isDurableMediaId } from '@src/utils/watchHistory/resolve'

/** Rows last written longer ago than this are outside the snapshot. */
export const POSITIONS_WINDOW_DAYS = 30

/** The most rows a snapshot holds: the most recent ones. */
export const POSITIONS_LIMIT = 200

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The user's most recent rows inside the window, newest first.
 *
 * A row flagged isValid:false is left out, as the list joins leave it out: the
 * flag says the sync could not match the row to a title, and nothing here
 * has matched it to one since. A title outside the viewer's library scope is
 * left out too (scopeRows.js), checked on the rows read, so a scoped viewer
 * can get fewer than the limit.
 *
 * Throws when the history cannot be read: an empty snapshot would say
 * "nothing watched".
 *
 * @param {string|import('mongodb').ObjectId} userId
 * @param {import('@src/lib/roles/libraryScope').LibraryAccess} access - the user's library access
 * @param {number} [now] - epoch ms, for the window's floor
 * @returns {Promise<Array<{ mediaId: string|null, normalizedVideoId: string|null, playbackTime: number, lastUpdated: Date|string|null }>>}
 *   `mediaId` is the durable identity ('mid:…') or null: a row can also carry
 *   an id a client once sent, which names no title.
 */
export async function readRecentPositions(userId, access, now = Date.now()) {
  const rows = await findPlaybackForUser(userId, {
    filter: {
      lastUpdated: { $gte: new Date(now - POSITIONS_WINDOW_DAYS * DAY_MS) },
      isValid: { $ne: false },
    },
    sort: { lastUpdated: -1 },
    limit: POSITIONS_LIMIT,
    // videoId is read for the scope check only (a row can match its title by
    // URL) and is not passed on
    projection: { _id: 0, videoId: 1, normalizedVideoId: 1, mediaId: 1, playbackTime: 1, lastUpdated: 1 },
  })

  const inScope = await watchRowsInScope(rows, access)

  return inScope.map((row) => ({
    mediaId: isDurableMediaId(row.mediaId) ? row.mediaId : null,
    normalizedVideoId: row.normalizedVideoId ?? null,
    playbackTime: Number.isFinite(row.playbackTime) ? row.playbackTime : 0,
    lastUpdated: row.lastUpdated ?? null,
  }))
}
