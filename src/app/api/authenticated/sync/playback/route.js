import { approvedGate } from '@src/lib/roles/gates'
import { libraryAccessFor } from '@src/lib/roles/libraryAccess'
import { refusePlaybackUserMismatch } from '@src/lib/playbackUser'
import { readTitlePosition } from '@src/utils/watchHistory/titlePosition'
import { isDurableMediaId } from '@src/utils/watchHistory/resolve'
import { createLogger } from '@src/lib/logger'

const log = createLogger('API.PlaybackPosition')

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

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
 * How the row is found, and why a row the sync flagged is returned like any
 * other, is in readTitlePosition (src/utils/watchHistory/titlePosition.js):
 * the same read a details page's server render makes for its seed.
 *
 * A browser names the user its page was rendered for (X-Playback-User), as on
 * the positions snapshot and every playback write, and a cookie request whose
 * session is someone else's is refused: 409, or 400 when it names no one
 * (src/lib/playbackUser.ts). The page plays from this answer and keeps it in
 * memory by title: answered for whoever holds the cookie now, it would start
 * one account's title at another's position. A Bearer client (the TV and
 * phone apps) is exempt: its token is its identity.
 */
export async function GET(req) {
  const user = await approvedGate.route()
  if (user instanceof Response) {
    return user
  }

  const mismatch = refusePlaybackUserMismatch(req, user.id, log)
  if (mismatch) return mismatch

  const { searchParams } = new URL(req.url)
  const videoId = searchParams.get('videoId') || null
  const mediaId = searchParams.get('mediaId') || null

  if (!videoId && !mediaId) {
    return json(400, { error: 'videoId or mediaId parameter required' })
  }
  if (mediaId && !isDurableMediaId(mediaId)) {
    return json(400, { error: 'mediaId must be a durable id (mid:…)' })
  }

  try {
    return json(200, await readTitlePosition({ userId: user.id, getAccess: () => libraryAccessFor(user), videoId, mediaId }))
  } catch (error) {
    // Never "no row": a client that believed it would start from 0 and save over the position
    log.error({ err: error, userId: user.id }, 'Failed to read the playback position')
    return json(500, { error: 'Failed to read the playback position' })
  }
}
