/**
 * Pure shaping for the admin Transcoder card: transcoder answers + title and viewer lookups →
 * the payload the card renders. No I/O, so the join is unit-tested on its own
 * (`transcoderSessions.js` does the fetching and the lookups).
 */

import { generateNormalizedVideoId } from '@src/utils/videoIdentity'

/**
 * The watch-history identity of a transcoder session's title: the same id the title's own
 * `videoURL` hashes to, because the identity layer decodes the `/stream/{key}/` address back to
 * the source path (videoIdentity.js). The host is irrelevant to the id.
 */
export function sessionVideoId(pathKey) {
  if (typeof pathKey !== 'string' || !pathKey) return null
  return generateNormalizedVideoId(`http://transcoder.invalid/stream/${pathKey}/master.m3u8`)
}

/** The file name a path key addresses, for a session whose title is not in the library. */
export function fileNameFromPathKey(pathKey) {
  try {
    const path = Buffer.from(pathKey, 'base64url').toString('utf8')
    const name = path.split('/').filter(Boolean).pop()
    return name || null
  } catch {
    return null
  }
}

function titleOf(doc) {
  if (!doc) return null
  if (doc.kind === 'episode') {
    return {
      kind: 'episode',
      show: doc.showTitle ?? doc.originalTitle ?? null,
      season: doc.seasonNumber ?? null,
      episode: doc.episodeNumber ?? null,
      name: doc.title ?? null,
    }
  }
  return { kind: 'movie', name: doc.title ?? doc.originalTitle ?? null }
}

const KIND_ORDER = { video: 0, direct: 1, audio: 2 }

/**
 * @param {Array<object>} transcoders - one per endpoint: target fields plus the fetch result
 * @param {Map<string, object>} titles - normalizedVideoId → `{ kind: 'movie'|'episode', ...doc }`
 * @param {Map<string, Array<object>>} viewers - normalizedVideoId → `[{ name, state, positionSec }]`
 */
export function shapeTranscoderDashboard(transcoders, titles, viewers, now = new Date()) {
  return {
    generatedAt: now.toISOString(),
    transcoders: transcoders.map((t) => {
      const base = {
        serverId: t.serverId,
        serverLabel: t.displayName || t.serverId,
        endpoint: t.endpoint,
        internal: Boolean(t.internalBase) && t.endpoint === t.internalBase,
        keyVariable: t.keyVariable,
      }
      if (!t.result?.ok) {
        return {
          ...base,
          ok: false,
          reason: t.result?.reason ?? 'not-configured',
          detail: t.result?.detail ?? t.problem ?? 'not configured',
        }
      }
      const data = t.result.data
      const sessions = (Array.isArray(data.sessions) ? data.sessions : [])
        .map((s) => {
          const nid = sessionVideoId(s.path_key)
          return {
            ...s,
            videoId: nid,
            title: titleOf(nid ? titles.get(nid) : null),
            file: fileNameFromPathKey(s.path_key),
            viewers: (nid && viewers.get(nid)) || [],
          }
        })
        // Group a title's sessions together (video, copy, audio), busiest titles first.
        .sort(
          (a, b) =>
            String(a.videoId).localeCompare(String(b.videoId)) ||
            (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) ||
            a.id - b.id
        )
      return {
        ...base,
        ok: true,
        ms: t.result.ms,
        version: data.version ?? null,
        load: data.load ?? null,
        capacity: data.capacity ?? null,
        gpu: Array.isArray(data.gpu) ? data.gpu : [],
        sessions,
      }
    }),
  }
}
