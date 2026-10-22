import 'server-only'

/**
 * The admin Transcoder card's data: every file server's transcoder (`GET /admin/sessions` via
 * transcoderAdmin.js), each session joined to its title and its current viewers. Admin-only:
 * served from the isAdmin GET of `[...admin]`, never the webhook-accepting POST.
 */

import clientPromise from '@src/lib/mongodb'
import { userQueries } from '@src/lib/userQueries'
import { DEFAULT_ACTIVE_WINDOW_SECONDS, PAUSED_WINDOW_SECONDS } from '@src/utils/playbackPresence/database'
import { getTranscoderTargets, fetchTargetSessions } from '@src/utils/jit/transcoderAdmin'
import { recordSamplerDuration } from '@src/utils/monitor_server_load'
import { sessionVideoId, shapeTranscoderDashboard } from './transcoderSessionsJoin'

async function lookupTitles(db, ids) {
  if (ids.length === 0) return new Map()
  const filter = { normalizedVideoId: { $in: ids } }
  const [movies, episodes] = await Promise.all([
    db.collection('FlatMovies').find(filter, { projection: { normalizedVideoId: 1, title: 1, originalTitle: 1 } }).toArray(),
    db
      .collection('FlatEpisodes')
      .find(filter, {
        projection: { normalizedVideoId: 1, showTitle: 1, originalTitle: 1, seasonNumber: 1, episodeNumber: 1, title: 1 },
      })
      .toArray(),
  ])
  const titles = new Map()
  for (const m of movies) titles.set(m.normalizedVideoId, { kind: 'movie', ...m })
  for (const e of episodes) titles.set(e.normalizedVideoId, { kind: 'episode', ...e })
  return titles
}

/** Who is watching each title now, with the same activity window as the media-activity view. */
async function lookupViewers(db, ids) {
  if (ids.length === 0) return new Map()
  const now = Date.now()
  const rows = await db
    .collection('PlaybackPresence')
    .find(
      {
        normalizedVideoId: { $in: ids },
        $or: [
          { isPaused: { $ne: true }, lastHeartbeat: { $gte: new Date(now - DEFAULT_ACTIVE_WINDOW_SECONDS * 1000) } },
          { isPaused: true, lastHeartbeat: { $gte: new Date(now - PAUSED_WINDOW_SECONDS * 1000) } },
        ],
      },
      { projection: { normalizedVideoId: 1, userId: 1, isPaused: 1, playbackTime: 1 } }
    )
    .toArray()
  const userIds = [...new Set(rows.map((r) => r.userId).filter(Boolean))]
  const users = userIds.length ? await userQueries.find({ _id: { $in: userIds } }, { name: 1, email: 1 }) : []
  const names = new Map(users.map((u) => [String(u._id), u.name || u.email || 'Unknown user']))
  const viewers = new Map()
  for (const r of rows) {
    if (!viewers.has(r.normalizedVideoId)) viewers.set(r.normalizedVideoId, [])
    viewers.get(r.normalizedVideoId).push({
      name: names.get(String(r.userId)) ?? 'Unknown user',
      state: r.isPaused ? 'paused' : 'playing',
      positionSec: Number.isFinite(r.playbackTime) ? Math.round(r.playbackTime) : null,
    })
  }
  return viewers
}

export async function getTranscoderDashboard() {
  const targets = await getTranscoderTargets()
  const calls = targets.flatMap((t) =>
    t.endpoints.length ? t.endpoints.map((endpoint) => ({ t, endpoint })) : [{ t, endpoint: null }]
  )
  const transcoders = await Promise.all(
    calls.map(async ({ t, endpoint }) => ({
      ...t,
      endpoint,
      result: endpoint ? await fetchTargetSessions(t, endpoint) : null,
    }))
  )

  const ids = [
    ...new Set(
      transcoders.flatMap((t) => (t.result?.ok ? t.result.data.sessions ?? [] : []).map((s) => sessionVideoId(s.path_key)))
    ),
  ].filter(Boolean)
  const db = (await clientPromise).db('Media')
  const [titles, viewers] = await Promise.all([lookupTitles(db, ids), lookupViewers(db, ids)])

  // Only the synchronous join and shaping are timed: the awaits above are network and database
  // waits that never block the event loop.
  const startedAt = performance.now()
  const payload = shapeTranscoderDashboard(transcoders, titles, viewers)
  recordSamplerDuration('transcoder_sessions', startedAt)
  return payload
}
