/**
 * A video's file facts: which of them a pass writes, and which it removes.
 *
 * duration, dimensions, size, hdr, mediaQuality and mediaLastModified describe
 * the file the document's videoURL points at, so they follow the video. For
 * movies and episodes alike:
 *
 *  1. They come from the server that owns the video (the caller ranks it,
 *     see core/ownership) and from nowhere else. A fact in its payload is
 *     written.
 *  2. A fact its payload does not report (null, undefined or '') is removed,
 *     but only on evidence:
 *     - the probe ran. A probed video always has a duration, so with one,
 *       `hdr: null` means the file is SDR; without one it means nothing. A
 *       file server that cannot probe a file (a file being replaced in
 *       place, a starved disk) still publishes it, with every fact null, and
 *       the stored facts are left alone: the file is there and its facts are
 *       unknown this scan.
 *     - or the file changed. Facts stored for ANOTHER file (the video was
 *       handed to this server, or replaced under a new name) are removed
 *       whether or not the new file has been probed: an unknown is better
 *       than the previous file's HDR label.
 *  3. mediaLastModified is written when the payload has a readable one and
 *     otherwise left alone: a file that exists has one, so its absence is a
 *     failed stat, not a fact.
 *  4. When the video itself is gone, every fact goes with it (the movie
 *     strategy, the only one that clears a video, removes VIDEO_FILE_FACTS).
 *
 * They used to be set-if-present, which left an "HDR10" label on a title
 * whose file had been replaced by an SDR one (the payload says hdr: null),
 * and the old file's numbers on anything the new payload lacked.
 *
 * Pure: says what to write and what to remove. Each caller writes in its own
 * way (the movie strategy into its update and unset lists, the episode
 * builder onto the entity), and reads the facts from its own payload shape.
 */

/** Everything on a document that describes the video file, in write order. */
export const VIDEO_FILE_FACTS = [
  'duration',
  'dimensions',
  'size',
  'hdr',
  'mediaQuality',
  'mediaLastModified',
] as const

export type VideoFileFact = (typeof VIDEO_FILE_FACTS)[number]

/** The facts the video owner's payload reports, in the document's units. */
export interface ReportedFileFacts {
  duration?: unknown
  dimensions?: unknown
  /** Bytes (see sizeInBytes). */
  size?: unknown
  hdr?: unknown
  mediaQuality?: unknown
  /** As the payload gives it: an ISO date string (or a Date). */
  mediaLastModified?: unknown
}

export interface FileFactsPlan {
  /** Facts to write, as reported. mediaLastModified is a Date. */
  set: Partial<Record<VideoFileFact, unknown>>
  /** Facts to remove, in VIDEO_FILE_FACTS order. Never mediaLastModified. */
  unset: VideoFileFact[]
  /** The payload carried a mediaLastModified that is not a date; the stored one stays. */
  unreadableModified: boolean
}

/** The facts mirrored from the payload: written when reported, removed on evidence. */
const MIRRORED_FACTS = ['duration', 'dimensions', 'size', 'hdr', 'mediaQuality'] as const

const reports = (value: unknown) => value !== undefined && value !== null && value !== ''

/**
 * What the video owner's pass writes and removes.
 *
 * @param reported - The facts its payload reports
 * @param fileChanged - The stored facts are of another file than the one the
 *   payload describes (see videoFileChanged)
 */
export function planVideoFileFacts(reported: ReportedFileFacts, fileChanged: boolean): FileFactsPlan {
  const probed = reported.duration !== undefined && reported.duration !== null
  const set: FileFactsPlan['set'] = {}
  const unset: VideoFileFact[] = []

  for (const fact of MIRRORED_FACTS) {
    if (reports(reported[fact])) set[fact] = reported[fact]
    else if (probed || fileChanged) unset.push(fact)
  }

  let unreadableModified = false
  if (reported.mediaLastModified) {
    const modified = new Date(reported.mediaLastModified as string | Date)
    if (Number.isNaN(modified.getTime())) unreadableModified = true
    else set.mediaLastModified = modified
  }

  return { set, unset, unreadableModified }
}

/**
 * Whether this pass points the document at another file than the one its
 * stored facts describe: another server's, or a replacement under a new name.
 * Never for a new document (nothing is stored), nor while an admin has locked
 * the video URL (the stored URL, and so its file, stays).
 *
 * @param stored - The stored document, or null for a new one
 * @param videoUrl - The video URL this pass writes
 * @param videoUrlLocked - Whether `videoURL` is admin-locked
 */
export function videoFileChanged(
  stored: { videoURL?: string | null } | null | undefined,
  videoUrl: string | null | undefined,
  videoUrlLocked: boolean
): boolean {
  return Boolean(stored) && !videoUrlLocked && stored!.videoURL !== videoUrl
}

/**
 * A file size in bytes, from the payload's number of bytes or its
 * `{ gb | mb | kb }` object (the first one present wins). Undefined for
 * anything else.
 */
export function sizeInBytes(size: unknown): number | undefined {
  if (typeof size === 'number') return size
  if (size && typeof size === 'object') {
    const { gb, mb, kb } = size as { gb?: unknown; mb?: unknown; kb?: unknown }
    if (typeof gb === 'number') return Math.round(gb * 1024 * 1024 * 1024)
    if (typeof mb === 'number') return Math.round(mb * 1024 * 1024)
    if (typeof kb === 'number') return Math.round(kb * 1024)
  }
  return undefined
}
