/**
 * The parts of a sync's report that the passes do not produce themselves: per
 * server, the titles listed with no video file yet (and why), and how many
 * titles the pass checked, updated, left unchanged and failed. The admin's
 * sync popup (components/Admin/SyncMediaPopup) renders them.
 *
 * Everything here is pure: syncAllServers hands it each server's payload and,
 * title by title, what the server's pass returned.
 */

import { SyncStatus } from '../core/types'

/**
 * The containers the processor serves (its SUPPORTED_CONTAINERS,
 * components/media-scanner/domain/jit-eligibility.mjs).
 */
const SERVED_VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.mkv', '.webm'])

/** Video extensions outside those five: a file of one of these is a video the library cannot serve. */
const OTHER_VIDEO_EXTENSIONS = new Set([
  '.avi', '.wmv', '.flv', '.mpg', '.mpeg', '.m2ts', '.mts', '.ts', '.vob', '.3gp', '.ogv',
  '.divx', '.rm', '.rmvb', '.asf', '.f4v', '.mxf', '.dv', '.m2v',
])

/** Endings download clients give a file they are still writing. */
const DOWNLOAD_EXTENSIONS = new Set(['.part', '.partial', '.!qb', '.!ut', '.crdownload', '.download'])

/** A file name's extension, lower case, with its dot ('' when it has none). */
function extensionOf(fileName) {
  const base = String(fileName).split(/[\\/]/).pop()
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot).toLowerCase() : ''
}

/**
 * Why a title's folder has no video the library can play, from the files in
 * it: a download still in progress first, then a video in a format the
 * processor does not serve (each such extension named), else no video file at
 * all.
 *
 * @param {string[]|null|undefined} fileNames - The folder's files, as the payload lists them
 * @returns {{ code: 'downloading'|'unsupported'|'none', label: string }}
 */
export function noVideoReason(fileNames) {
  const extensions = (Array.isArray(fileNames) ? fileNames : []).map(extensionOf)
  if (extensions.some((extension) => DOWNLOAD_EXTENSIONS.has(extension))) {
    return { code: 'downloading', label: 'still downloading' }
  }
  const unsupported = [...new Set(extensions.filter((extension) => OTHER_VIDEO_EXTENSIONS.has(extension)))].sort()
  if (unsupported.length > 0 && !extensions.some((extension) => SERVED_VIDEO_EXTENSIONS.has(extension))) {
    return { code: 'unsupported', label: `unsupported format (${unsupported.join(', ')})` }
  }
  return { code: 'none', label: 'no video file' }
}

/**
 * The titles a server lists with no video file yet. A movie with no primary
 * video (the payload's `urls.mp4`, the processor's name for the primary video
 * of any container), with the reason its file list gives. A show with no
 * season, a season with no episode that has a video, and a show none of whose
 * seasons has one. A season's payload carries no file list (the processor
 * leaves out a season folder with no video), so a show's or season's reason
 * is always "no video file".
 *
 * @param {{ movies?: Object, tv?: Object }} fileServer - One server's payload
 * @returns {{ movies: Array<{title: string, reason: string}>,
 *   tv: Array<{title: string, season: string|null, reason: string}> }}
 */
export function noVideoTitles(fileServer) {
  const movies = []
  for (const [title, entry] of Object.entries(fileServer?.movies ?? {})) {
    if (!entry?.urls?.mp4) movies.push({ title, reason: noVideoReason(entry?.fileNames).label })
  }

  const tv = []
  const none = noVideoReason([]).label
  for (const [title, show] of Object.entries(fileServer?.tv ?? {})) {
    const seasons = Object.entries(show?.seasons ?? {})
    let anyVideo = false
    for (const [seasonKey, season] of seasons) {
      const episodes = Object.values(season?.episodes ?? {})
      if (episodes.some((episode) => episode?.videoURL)) anyVideo = true
      else tv.push({ title, season: seasonKey, reason: none })
    }
    if (!anyVideo) tv.push({ title, season: null, reason: none })
  }
  return { movies, tv }
}

/** Whether a result says its write changed the document's data (or created it). */
const changedDocument = (result) =>
  result?.status === SyncStatus.Completed && (result.metadata?.documentChanged === true || result.metadata?.created === true)

/**
 * How one server's pass went, title by title (a movie, or a show with its
 * seasons and episodes): checked, updated (a result says its write changed
 * a document's data: `documentChanged`, or `created`; "completed" alone only
 * says the write ran), unchanged (nothing changed: its gate showed nothing
 * had changed since the server's last complete pass, or the pass found
 * nothing to change) and failed (any result failed). Every title checked is
 * in exactly one of the other three.
 *
 * @returns {{
 *   record: (kind: 'movies'|'tv', title: string, results: Array<Object>) => void,
 *   counts: () => { checked: number, updated: number, unchanged: number, failed: number,
 *     failures: Array<{kind: 'movies'|'tv', title: string, error: string}> }
 * }}
 */
export function createTitleCounts() {
  const counts = { checked: 0, updated: 0, unchanged: 0, failed: 0 }
  const failures = []
  return {
    record(kind, title, results = []) {
      counts.checked += 1
      const failed = results.find((result) => result?.status === SyncStatus.Failed)
      if (failed) {
        counts.failed += 1
        failures.push({ kind, title, error: failed.errors?.find(Boolean) ?? 'failed without a message' })
      } else if (results.some(changedDocument)) {
        counts.updated += 1
      } else {
        counts.unchanged += 1
      }
    },
    counts: () => ({ ...counts, failures: [...failures] }),
  }
}
