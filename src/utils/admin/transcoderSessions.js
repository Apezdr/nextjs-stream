import 'server-only'

/**
 * The admin Transcoder card's data: every file server's transcoder (`GET /admin/sessions` via
 * transcoderAdmin.js), each session joined to its title and its current viewers. Admin-only:
 * served from the isAdmin GET of `[...admin]`, never the webhook-accepting POST.
 */

import clientPromise from '@src/lib/mongodb'
import { userQueries } from '@src/lib/userQueries'
import { findLiveSessions } from '@src/utils/playbackPresence/live'
import { livePosition } from '@src/utils/playbackPresence/position'
import { getTranscoderTargets, fetchTargetSessions } from '@src/utils/jit/transcoderAdmin'
import { recordSamplerDuration } from '@src/utils/monitor_server_load'
import { sessionVideoId, shapeTranscoderDashboard } from './transcoderSessionsJoin'

async function lookupTitles(db, ids) {
  if (ids.length === 0) return new Map()
  const filter = { normalizedVideoId: { $in: ids } }
  const [movies, episodes] = await Promise.all([
    db
      .collection('FlatMovies')
      .find(filter, { projection: { normalizedVideoId: 1, title: 1, originalTitle: 1, duration: 1 } })
      .toArray(),
    db
      .collection('FlatEpisodes')
      .find(filter, {
        projection: {
          normalizedVideoId: 1,
          showTitle: 1,
          originalTitle: 1,
          seasonNumber: 1,
          episodeNumber: 1,
          title: 1,
          duration: 1,
        },
      })
      .toArray(),
  ])
  const titles = new Map()
  for (const m of movies) titles.set(m.normalizedVideoId, { kind: 'movie', ...m })
  for (const e of episodes) titles.set(e.normalizedVideoId, { kind: 'episode', ...e })
  return titles
}

/**
 * Who is watching each title now. A transcoder session knows its title only by
 * the stream path, so this is the one reader that matches on normalizedVideoId.
 */
async function lookupViewers(ids) {
  if (ids.length === 0) return new Map()
  const sessions = await findLiveSessions({ normalizedVideoIds: ids })
  const userIds = [...new Set(sessions.map((s) => s.userId))]
  const users = userIds.length ? await userQueries.find({ _id: { $in: userIds } }, { name: 1, email: 1 }) : []
  const names = new Map(users.map((u) => [String(u._id), u.name || u.email || 'Unknown user']))
  const nowMs = Date.now()
  const viewers = new Map()
  for (const s of sessions) {
    if (!viewers.has(s.normalizedVideoId)) viewers.set(s.normalizedVideoId, [])
    const position = livePosition(s, nowMs)
    viewers.get(s.normalizedVideoId).push({
      name: names.get(s.userId) ?? 'Unknown user',
      state: s.state,
      positionSec: position === null ? null : Math.round(position),
      device: s.device.label,
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

  const live = transcoders.flatMap((t) => (t.result?.ok ? t.result.data.sessions ?? [] : []))
  const problems = transcoders.flatMap((t) => (t.result?.ok ? t.result.data.recent_problems ?? [] : []))
  const liveIds = [...new Set(live.map((s) => sessionVideoId(s.path_key)))].filter(Boolean)
  // A problem's title may no longer be playing, so it is looked up too; viewers only for live ones.
  const titleIds = [...new Set([...liveIds, ...problems.map((p) => sessionVideoId(p.path_key))])].filter(Boolean)
  const db = (await clientPromise).db('Media')
  const [titles, viewers] = await Promise.all([lookupTitles(db, titleIds), lookupViewers(liveIds)])

  // Only the synchronous join and shaping are timed: the awaits above are network and database
  // waits that never block the event loop.
  const startedAt = performance.now()
  const payload = shapeTranscoderDashboard(transcoders, titles, viewers)
  recordSamplerDuration('transcoder_sessions', startedAt)
  return payload
}
