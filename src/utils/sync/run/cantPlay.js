/**
 * The movies and episodes the library hides although they have a video: the
 * sync report's "Can't play yet on <server>" section
 * (components/Admin/SyncMediaPopup). Their primary video is one the player
 * cannot play and the transcoder does not serve (a format it does not take, an
 * `.avi` today; or a file the processor did not offer it, cantPlayReason), so
 * the library's visibility rule (utils/mediaVisibility isWebVisible, the one
 * predicate every list, rail, count and search applies) hides them, and
 * nothing else says so.
 *
 * Read from the library after every server's pass of a sync an admin started
 * (always a tick over every title; never a webhook tick), so the list is
 * complete whichever titles the passes wrote. Each title is reported under the
 * server its video came from (`videoSource`).
 */

import { isWebVisible } from '@src/utils/mediaVisibility'
import { SERVED_VIDEO_EXTENSIONS } from './syncReport'

/** A document with a video: the only ones this report is about (the others are "no video file yet"). */
const HAS_VIDEO = { videoURL: { $type: 'string', $ne: '' } }

/** The fields isWebVisible reads, the sources (their jitReason), and the server the video came from. */
const VISIBILITY_FIELDS = {
  videoURL: 1,
  primaryContainer: 1,
  jitUrl: 1,
  jitEligible: 1,
  jitServeOverride: 1,
  videoSource: 1,
  // For the primary source's jitReason (the reason only)
  sources: 1,
}

/** Where a document with no `videoSource` is listed. */
const UNKNOWN_SERVER = '(unknown server)'

/** The primary video's format: its container, else its URL's extension. */
function formatOf(doc) {
  if (typeof doc.primaryContainer === 'string' && doc.primaryContainer) return doc.primaryContainer.toLowerCase()
  const pathname = typeof doc.videoURL === 'string' ? doc.videoURL.split(/[?#]/)[0] : ''
  const match = /\.([a-z0-9]+)$/i.exec(pathname)
  return match ? match[1].toLowerCase() : 'unknown'
}

/**
 * The processor's reasons a source is not recommended for the transcoder (its
 * `jitReason`, components/media-scanner/domain/jit-eligibility.mjs), as the
 * report says them.
 */
const JIT_REASONS = {
  'container-unsupported': (format) => `unsupported format (${format})`,
  'host-disabled': (format) => `the transcoder is turned off on this server (${format})`,
  'probe-incomplete': (format) => `the file has not been fully probed yet (${format})`,
}

/** The primary source the document stores, if it stores its sources. */
const primarySourceOf = (doc) => (Array.isArray(doc.sources) ? doc.sources.find((source) => source?.isPrimary) ?? null : null)

/**
 * Why the library hides a document that has a video, or null when it does
 * not hide it (or it has no video). Whether it is hidden is isWebVisible's
 * answer, nothing else. The reason: an admin turned the transcoder off for the
 * title; else the processor's `jitReason` for the primary source; else a
 * transcoder-ready file with no transcoder address; else the format itself
 * when the processor serves no such container; else that the file is not
 * offered to the transcoder. Each names the format.
 *
 * @param {Object|null|undefined} doc - A movie or episode document
 * @returns {string|null}
 */
export function cantPlayReason(doc) {
  if (!doc) return null
  const hasVideo =
    (typeof doc.videoURL === 'string' && doc.videoURL !== '') ||
    (typeof doc.primaryContainer === 'string' && doc.primaryContainer !== '')
  if (!hasVideo || isWebVisible(doc)) return null
  const format = `.${formatOf(doc)}`
  if (doc.jitServeOverride === 'off') return `transcoding turned off for this title (${format})`
  const jitReason = primarySourceOf(doc)?.jitReason
  if (typeof jitReason === 'string' && jitReason) {
    return JIT_REASONS[jitReason]?.(format) ?? `the transcoder does not take it: ${jitReason} (${format})`
  }
  if (doc.jitEligible === true && !doc.jitUrl) return `no transcoder address is configured (${format})`
  if (!SERVED_VIDEO_EXTENSIONS.has(format)) return `unsupported format (${format})`
  return `not offered to the transcoder (${format})`
}

/** The server's entry of `out`, created on first use. */
function serverEntry(out, serverId) {
  const id = serverId || UNKNOWN_SERVER
  out[id] ??= { movies: [], tv: [], count: 0 }
  return out[id]
}

/**
 * Per server, the movies and the episodes (by show and season) the library
 * hides although they have a video, with the reason each is hidden.
 *
 * @param {import('mongodb').Db} db - The media database
 * @returns {Promise<Object<string, {
 *   movies: Array<{title: string, reason: string}>,
 *   tv: Array<{title: string, season: number, episodes: Array<{episode: number, reason: string}>}>,
 *   count: number
 * }>>} `count` is the movies plus the episodes
 */
export async function cantPlayTitles(db) {
  const [movies, episodes] = await Promise.all([
    db.collection('FlatMovies').find(HAS_VIDEO, { projection: { originalTitle: 1, ...VISIBILITY_FIELDS } }).toArray(),
    db
      .collection('FlatEpisodes')
      .find(HAS_VIDEO, { projection: { showId: 1, seasonNumber: 1, episodeNumber: 1, ...VISIBILITY_FIELDS } })
      .toArray(),
  ])
  const out = {}

  for (const movie of movies) {
    const reason = cantPlayReason(movie)
    if (!reason) continue
    const entry = serverEntry(out, movie.videoSource)
    entry.movies.push({ title: movie.originalTitle, reason })
    entry.count += 1
  }

  const hidden = episodes.map((episode) => ({ episode, reason: cantPlayReason(episode) })).filter((e) => e.reason)
  const showIds = [...new Set(hidden.map(({ episode }) => episode.showId).filter((id) => id != null))]
  const shows = showIds.length
    ? await db.collection('FlatTVShows').find({ _id: { $in: showIds } }, { projection: { originalTitle: 1 } }).toArray()
    : []
  const showTitle = new Map(shows.map((show) => [String(show._id), show.originalTitle]))
  for (const { episode, reason } of hidden) {
    const entry = serverEntry(out, episode.videoSource)
    const title = showTitle.get(String(episode.showId)) ?? String(episode.showId)
    let season = entry.tv.find((s) => s.title === title && s.season === episode.seasonNumber)
    if (!season) {
      season = { title, season: episode.seasonNumber, episodes: [] }
      entry.tv.push(season)
    }
    season.episodes.push({ episode: episode.episodeNumber, reason })
    entry.count += 1
  }

  for (const entry of Object.values(out)) {
    entry.movies.sort((a, b) => a.title.localeCompare(b.title))
    entry.tv.sort((a, b) => a.title.localeCompare(b.title) || a.season - b.season)
    for (const season of entry.tv) season.episodes.sort((a, b) => a.episode - b.episode)
  }
  return out
}
