/**
 * One viewer's position in one title, read now: what
 * GET /api/authenticated/sync/playback answers, and what a details page's
 * server render hands the browser with the page (TitlePlaybackSeed).
 *
 * The title is given by the URL it plays from (`videoId`), by its durable id
 * (`mediaId`, 'mid:…'), or both. The row is found by index, without loading
 * the user's history:
 *   1. the hash of `videoId` ({userId, normalizedVideoId})
 *   2. the durable id ({userId, mediaId}): the one asked for and the one the
 *      catalog gives for the URL (two only when two titles play from one
 *      file). This is the row a quality swap or a rename left under the old
 *      file's hash.
 *   3. asked by `mediaId` alone: the hash of the file the title plays today,
 *      for a row that was never stamped with the id
 *   4. the raw `videoId` string, last, for a row from before URLs were
 *      hashed the way they are now. The only arm with no index of its own,
 *      and it runs only when the others found nothing.
 *
 * A row flagged isValid:false is returned like any other. The flag is the
 * sync saying it could not match the row to a title; a read that has just
 * matched it to one by hash or id knows better, and a client told "no row"
 * would start the title from 0 and save over the position.
 */

import { findPlaybackForUser } from '@src/utils/watchHistory/database'
import { watchRowsInScope } from '@src/utils/watchHistory/scopeRows'
import { generateNormalizedVideoId } from '@src/utils/videoIdentity'
import { resolveMediaIdForNid, resolveTitleForMediaId } from '@src/utils/watchHistory/mediaIdResolver'
import { computeWatchProgress } from '@src/utils/watchHistory/progress'
import { isDurableMediaId } from '@src/utils/watchHistory/resolve'

// What a position read needs of a row: never the device or the addresses
const ROW_FIELDS = { _id: 0, videoId: 1, normalizedVideoId: 1, mediaId: 1, playbackTime: 1, lastUpdated: 1 }

const writtenAt = (row) => new Date(row.lastUpdated || 0).getTime()

/** The user's most recently written row matching the filter, or null. One indexed read. */
async function newestRow(userId, filter) {
  const rows = await findPlaybackForUser(userId, { filter, projection: ROW_FIELDS })
  return rows.reduce((newest, row) => (!newest || writtenAt(row) > writtenAt(newest) ? row : newest), null)
}

/**
 * @param {Object} options
 * @param {string|import('mongodb').ObjectId} options.userId - the viewer
 * @param {() => Promise<import('@src/lib/roles/libraryScope').LibraryAccess>} options.getAccess -
 *   the viewer's library access, asked for only when a row was found: a title
 *   outside the viewer's scope has no position to give
 * @param {string|null} [options.videoId] - the URL the title plays from
 * @param {string|null} [options.mediaId] - its durable id ('mid:…'); the caller has checked it is one
 * @returns {Promise<{ videoId: string|null, playbackTime: number, lastUpdated: Date|string|null, completed: boolean, progressPercent: number, found: boolean, mediaId: string|null, normalizedVideoId: string|null, asOf: string }>}
 *   `found: false` means the read was made and there is no row. `asOf` is the
 *   server's clock at the read, to set against `lastUpdated` and a save's
 *   `savedAt`, which are the server's too.
 * @throws when the history cannot be read: never "no row", which a client
 *   would believe, start from 0 and save over the position
 */
export async function readTitlePosition({ userId, getAccess, videoId = null, mediaId = null }) {
  const normalizedVideoId = videoId ? generateNormalizedVideoId(videoId) : null

  // The catalog's word on the title (cached, fail-open): its durable id and
  // its runtime, for the completion flag
  const byUrl = normalizedVideoId ? await resolveMediaIdForNid(normalizedVideoId) : null
  // Asked by id, and the URL (if any) is not a file the catalog knows
  const byId = mediaId && !byUrl ? await resolveTitleForMediaId(mediaId) : null
  // The ids a row for this title can carry: the one asked for, and the one
  // the catalog gives the file. They differ when two titles play from one
  // file, which nothing in the catalog rules out (its normalizedVideoId index
  // is not unique) and the catalog names only one of them for the hash. The
  // position is the file's, and each of its titles is given it, as on a list:
  // refusing the request would leave one of the two unable to resume.
  const durableIds = [...new Set([mediaId, byUrl?.mediaId].filter(Boolean))]
  const durationMs = byUrl?.durationMs ?? byId?.durationMs ?? null

  let row = null
  if (normalizedVideoId) {
    row = await newestRow(userId, { normalizedVideoId })
  }
  if (!row && durableIds.length > 0) {
    row = await newestRow(userId, { mediaId: durableIds.length === 1 ? durableIds[0] : { $in: durableIds } })
  }
  if (!row && byId?.normalizedVideoId && byId.normalizedVideoId !== normalizedVideoId) {
    row = await newestRow(userId, { normalizedVideoId: byId.normalizedVideoId })
  }
  if (!row && videoId) {
    row = await newestRow(userId, { videoId })
  }

  // A title outside the user's library scope has no position to give: the
  // check reads that one row's title, nothing more
  if (row) {
    const [kept] = await watchRowsInScope([row], await getAccess())
    row = kept ?? null
  }

  const asOf = new Date().toISOString()

  if (!row) {
    return {
      videoId,
      playbackTime: 0,
      lastUpdated: null,
      completed: false,
      progressPercent: 0,
      found: false,
      mediaId,
      normalizedVideoId,
      asOf,
    }
  }

  const playbackTime = row.playbackTime || 0
  const progress = computeWatchProgress(playbackTime, durationMs)

  return {
    videoId: row.videoId,
    playbackTime,
    lastUpdated: row.lastUpdated,
    completed: progress.completed,
    progressPercent: progress.progressPercent,
    found: true,
    // The row's own keys, the ones a positions snapshot row carries
    mediaId: isDurableMediaId(row.mediaId) ? row.mediaId : null,
    normalizedVideoId: row.normalizedVideoId ?? null,
    asOf,
  }
}
