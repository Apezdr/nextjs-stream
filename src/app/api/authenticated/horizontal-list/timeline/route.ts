// src/app/api/authenticated/horizontal-list/timeline/route.ts
// The signed-in user's Watch History counted by calendar day, for the date
// strip under the Watch History row and its month and day picker.
//
//   GET ?tz=America/New_York
//     →  { timeZone, total, days: [["2026-11-16", 9], ["2026-11-15", 4], …] }
//
// Days are newest first and hold only days with something watched. They count
// the rows of horizontal-list?type=recentlyWatched in that list's order, so
// the days before a day add up to the list position of its first title
// (src/utils/watchHistory/timeline.js). `total` is the length of the list.
//
// `tz` is required: a day is the viewer's, and the server cannot know it.
// Always the caller's own history: there is no userId parameter, and under
// "View as" the caller is the viewed user.
//
// Under /horizontal-list, which SELF_CACHED_API_PREFIXES (src/proxy.ts) lists:
// the proxy's no-store default would replace the Cache-Control below and no
// poll would get a 304.
import { approvedGate } from '@src/lib/roles/gates'
import { isTimeZone, readWatchDays } from '@src/utils/watchHistory/timeline'
import { generateETag, hasMatchingETag, createNotModifiedResponse } from '@src/utils/cache/etagHelpers'
import { createLogger } from '@src/lib/logger'

const log = createLogger('API.WatchTimeline')

// One user's history: never a shared cache's to keep, and revalidated each time
const CACHE_CONTROL = 'private, no-cache'
const NOT_CACHED = { 'Cache-Control': 'no-store, private' }

export async function GET(request: Request) {
  const user = await approvedGate.route()
  if (user instanceof Response) return user

  const timeZone = new URL(request.url).searchParams.get('tz') ?? ''
  if (!isTimeZone(timeZone)) {
    return Response.json(
      { error: 'tz must be an IANA time zone, such as America/New_York' },
      { status: 400, headers: NOT_CACHED }
    )
  }

  let counted
  try {
    counted = await readWatchDays(user.id, timeZone)
  } catch (error) {
    // Never an empty answer: that would say "nothing watched"
    log.error({ err: error, userId: user.id }, 'Failed to count watch history by day')
    return Response.json({ error: 'Failed to read watch history' }, { status: 500, headers: NOT_CACHED })
  }

  const body = JSON.stringify({ timeZone, total: counted.total, days: counted.days })
  const etag = generateETag(body)
  if (hasMatchingETag(request, etag)) {
    return createNotModifiedResponse(etag, { 'Cache-Control': CACHE_CONTROL })
  }

  return new Response(body, {
    headers: { 'Content-Type': 'application/json', ETag: etag, 'Cache-Control': CACHE_CONTROL },
  })
}
