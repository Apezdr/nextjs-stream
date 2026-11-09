// src/app/api/authenticated/presence/route.ts
// The signed-in user's own live viewing sessions, for "watching now" on media
// pages (plans/media-activity-presence.md, "A user's own sessions").
//
//   GET                                          every live session
//   GET ?mediaId=mid:…[&normalizedVideoId=…]     sessions on one movie or episode
//   GET ?showId=<id>[&season=N]                  sessions on a show, or one season
//
// Always the caller's own sessions: there is no userId parameter, and under
// "View as" the caller is the viewed user. Never cached: it is live.
import { NextResponse } from 'next/server'
import { approvedGate } from '@src/lib/roles/gates'
import { findOwnLiveSessions } from '@src/utils/playbackPresence/personal'
import { sessionsOnShow, sessionsOnTitle } from '@src/utils/playbackPresence/session'
import { createLogger } from '@src/lib/logger'

const log = createLogger('API.Presence')

const NO_STORE = { 'Cache-Control': 'no-store, private' }
const OBJECT_ID = /^[0-9a-f]{24}$/i
const MAX_ID_LENGTH = 256

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400, headers: NO_STORE })
}

export async function GET(request: Request) {
  const user = await approvedGate.route()
  if (user instanceof Response) return user

  const params = new URL(request.url).searchParams
  const mediaId = params.get('mediaId') || null
  const normalizedVideoId = params.get('normalizedVideoId') || null
  const showId = params.get('showId') || null
  const seasonParam = params.get('season')

  const byTitle = Boolean(mediaId || normalizedVideoId)
  if (byTitle && showId) return badRequest('Filter by a title or by a show, not both')
  if ((mediaId?.length ?? 0) > MAX_ID_LENGTH || (normalizedVideoId?.length ?? 0) > MAX_ID_LENGTH) {
    return badRequest('Invalid title id')
  }
  if (showId && !OBJECT_ID.test(showId)) return badRequest('Invalid showId')

  let season: number | null = null
  if (seasonParam !== null) {
    if (!showId) return badRequest('season needs a showId')
    season = Number(seasonParam)
    if (!Number.isInteger(season) || season < 0) return badRequest('Invalid season')
  }

  try {
    const own = await findOwnLiveSessions(user.id)
    const sessions = byTitle
      ? sessionsOnTitle(own, { mediaId, normalizedVideoId })
      : showId
        ? sessionsOnShow(own, showId, season)
        : own
    return NextResponse.json({ sessions }, { headers: NO_STORE })
  } catch (error) {
    log.error({ err: error, userId: user.id }, 'Failed to read own live sessions')
    return NextResponse.json({ error: 'Failed to read live sessions' }, { status: 500, headers: NO_STORE })
  }
}
