// src/app/api/authenticated/sync/positions/route.ts
// The signed-in user's recent positions, as one snapshot: their 200 most
// recent rows of the last 30 days (src/utils/watchHistory/positions.js).
//
//   GET  →  { userId, asOf, rows: [{ mediaId, normalizedVideoId, playbackTime, lastUpdated }] }
//
// Always the caller's own: there is no userId parameter, and under "View as"
// the caller is the viewed user. `userId` says whose rows these are, so a page
// can tell a snapshot of another account's from its own.
//
// A browser names the user its page was rendered for (X-Playback-User), as on
// every playback write, and a cookie request whose session is someone else's
// is refused: 409, or 400 when it names no one (src/lib/playbackUser.ts).
// Positions keyed by title would otherwise cross from one account to the next
// in the same browser. A Bearer client is exempt: its token is its identity.
//
// `asOf` is the server's clock when the rows were read. It is not part of the
// ETag, which covers whose rows and what they hold: a 304 means "these rows,
// still", and has no body to carry a time in.
//
// Listed in SELF_CACHED_API_PREFIXES (src/proxy.ts), or the proxy's no-store
// default would replace the Cache-Control below and no poll would get a 304.
import { approvedGate } from '@src/lib/roles/gates'
import { libraryAccessFor } from '@src/lib/roles/libraryAccess'
import { refusePlaybackUserMismatch } from '@src/lib/playbackUser'
import { readRecentPositions } from '@src/utils/watchHistory/positions'
import { generateETag, hasMatchingETag, createNotModifiedResponse } from '@src/utils/cache/etagHelpers'
import { createLogger } from '@src/lib/logger'

const log = createLogger('API.Positions')

// One user's rows: never a shared cache's to keep, and revalidated each time
const CACHE_CONTROL = 'private, no-cache'

export async function GET(request: Request) {
  const user = await approvedGate.route()
  if (user instanceof Response) return user

  const mismatch = refusePlaybackUserMismatch(request, user.id, log)
  if (mismatch) return mismatch

  let rows
  try {
    rows = await readRecentPositions(user.id, await libraryAccessFor(user))
  } catch (error) {
    // Never an empty snapshot: that would say "nothing watched"
    log.error({ err: error, userId: user.id }, 'Failed to read positions')
    return Response.json({ error: 'Failed to read positions' }, { status: 500, headers: { 'Cache-Control': 'no-store, private' } })
  }

  const etag = generateETag(JSON.stringify({ userId: user.id, rows }))
  if (hasMatchingETag(request, etag)) {
    return createNotModifiedResponse(etag, { 'Cache-Control': CACHE_CONTROL })
  }

  return Response.json(
    { userId: user.id, asOf: new Date().toISOString(), rows },
    { headers: { ETag: etag, 'Cache-Control': CACHE_CONTROL } }
  )
}
