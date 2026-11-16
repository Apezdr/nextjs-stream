import { approvedGate } from '@src/lib/roles/gates'
import { libraryAccessFor } from '@src/lib/roles/libraryAccess'
import { findPlaybackForUser } from '@src/utils/watchHistory/database'
import { watchRowsInScope } from '@src/utils/watchHistory/scopeRows'
import { generateNormalizedVideoId } from '@src/utils/videoIdentity'
import { resolveMediaIdForNid, resolveTitleForMediaId } from '@src/utils/watchHistory/mediaIdResolver'
import { computeWatchProgress } from '@src/utils/watchHistory/progress'
import { isDurableMediaId } from '@src/utils/watchHistory/resolve'
import { createLogger } from '@src/lib/logger'

const log = createLogger('API.PlaybackPosition')

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// What a position read needs of a row: never the device or the addresses
const ROW_FIELDS = { _id: 0, videoId: 1, normalizedVideoId: 1, mediaId: 1, playbackTime: 1, lastUpdated: 1 }

const writtenAt = (row) => new Date(row.lastUpdated || 0).getTime()

/** The user's most recently written row matching the filter, or null. One indexed read. */
async function newestRow(userId, filter) {
  const rows = await findPlaybackForUser(userId, { filter, projection: ROW_FIELDS })
  return rows.reduce((newest, row) => (!newest || writtenAt(row) > writtenAt(newest) ? row : newest), null)
}

/**
 * GET /api/authenticated/sync/playback?videoId=<url>&mediaId=<mid:…>
 *
 * The caller's position in one title, read now. Give the title by the URL it
 * plays from (`videoId`), by its durable id (`mediaId`, 'mid:…'), or both.
 *
 *   { found, playbackTime, lastUpdated, completed, progressPercent,
 *     videoId, mediaId, normalizedVideoId, asOf }
 *
 * `found: false` means the read was made and there is no row: `playbackTime`
 * is 0 and `completed` false. A read that could not be made is a 500, never
 * that. `asOf` is the server's clock at the read, to set against `lastUpdated`
 * and a save's `savedAt`, which are the server's too.
 *
 * The row is found by index, without loading the user's history:
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
export async function GET(req) {
  const user = await approvedGate.route()
  if (user instanceof Response) {
    return user
  }

  const { searchParams } = new URL(req.url)
  const videoId = searchParams.get('videoId') || null
  const mediaId = searchParams.get('mediaId') || null

  if (!videoId && !mediaId) {
    return json(400, { error: 'videoId or mediaId parameter required' })
  }
  if (mediaId && !isDurableMediaId(mediaId)) {
    return json(400, { error: 'mediaId must be a durable id (mid:…)' })
  }

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
  try {
    if (normalizedVideoId) {
      row = await newestRow(user.id, { normalizedVideoId })
    }
    if (!row && durableIds.length > 0) {
      row = await newestRow(user.id, { mediaId: durableIds.length === 1 ? durableIds[0] : { $in: durableIds } })
    }
    if (!row && byId?.normalizedVideoId && byId.normalizedVideoId !== normalizedVideoId) {
      row = await newestRow(user.id, { normalizedVideoId: byId.normalizedVideoId })
    }
    if (!row && videoId) {
      row = await newestRow(user.id, { videoId })
    }

    // A title outside the user's library scope has no position to give: the
    // check reads that one row's title, nothing more
    if (row) {
      const [kept] = await watchRowsInScope([row], await libraryAccessFor(user))
      row = kept ?? null
    }
  } catch (error) {
    // Never "no row": a client that believed it would start from 0 and save over the position
    log.error({ err: error, userId: user.id }, 'Failed to read the playback position')
    return json(500, { error: 'Failed to read the playback position' })
  }

  const asOf = new Date().toISOString()

  if (!row) {
    return json(200, {
      videoId,
      playbackTime: 0,
      lastUpdated: null,
      completed: false,
      progressPercent: 0,
      found: false,
      mediaId,
      normalizedVideoId,
      asOf,
    })
  }

  const playbackTime = row.playbackTime || 0
  const progress = computeWatchProgress(playbackTime, durationMs)

  return json(200, {
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
  })
}
