/**
 * Where playback begins on the web watch page: one resolution per mount.
 *
 * Pure helpers (no React) so the order is testable on its own:
 *
 *   1. an explicit `?start=` deep link, INCLUDING `?start=0`: a present zero
 *      is a request to restart, not an absent value (the next-episode card
 *      links with it, and a finished episode must not reopen in its credits)
 *   2. the server's row, asked for as the player mounts
 *      (GET /api/authenticated/sync/playback): a finished title starts over,
 *      a row gives its position, no row means the top
 *   3. when the server gives no answer in time (slow, failed, refused): what
 *      this page last knew. That is the position its own player last reached
 *      when the page has played before (a page shown again), else the
 *      position the page was rendered with.
 *
 * Every mount asks, the first as well as a page shown again: the position
 * the page was rendered with is as old as the render, and the row may have
 * moved on another device since. Resuming at the rendered value and then
 * saving from it is how a web tab used to overwrite a newer position.
 *
 * Nothing here reads the browser's storage or the positions store. The
 * record is the server's row; the store is for drawing bars.
 */

import { playbackReadHeaders } from '@src/lib/playbackUser'

/**
 * @param {unknown} start - the raw `?start=` search param
 * @returns {number|null} an explicit start in seconds (0 allowed), or null
 */
export function parseExplicitStart(start) {
  if (start === null || start === undefined || start === '' || start === false) return null
  const n = Number(start)
  return Number.isFinite(n) && n >= 0 ? n : null
}

const position = (value) => (Number.isFinite(value) && value > 0 ? value : null)

/**
 * Where this mount starts, from what it was told.
 *
 * @param {Object} known
 * @param {number|null} [known.explicitStart] - from `?start=` (parseExplicitStart)
 * @param {{ kind: 'row', playbackTime: number, completed: boolean }|{ kind: 'none' }|{ kind: 'unavailable' }|null} [known.answer] -
 *   the server's answer (fetchServerResume)
 * @param {number|null} [known.lastKnownPosition] - where this page's own player last was, if it has played
 * @param {number|null} [known.savedPlaybackTime] - the position the page was rendered with
 * @returns {number|null} seconds; 0 for a restart (an explicit one, or a finished title); null for "from the top"
 */
export function resolveResume({ explicitStart = null, answer = null, lastKnownPosition = null, savedPlaybackTime = null } = {}) {
  if (explicitStart !== null && explicitStart !== undefined) return explicitStart
  if (answer?.kind === 'row') return answer.completed ? 0 : position(answer.playbackTime)
  if (answer?.kind === 'none') return null
  // No answer. The page's own player is later knowledge than its render.
  return position(lastKnownPosition) ?? position(savedPlaybackTime)
}

/** The answer when the server could not be asked, or did not answer in time. */
const UNAVAILABLE = Object.freeze({ kind: 'unavailable' })

/**
 * Ask the server where the viewer is in a title. The request names the user
 * the page was rendered for, and the server refuses it once the browser's
 * session is someone else's: another account's position is never played from.
 *
 * Never rejects: a slow answer (past `timeoutMs`), a failure and a refusal
 * all resolve to `{ kind: 'unavailable' }`, and the caller starts from what
 * the page knew.
 *
 * @param {Object} title
 * @param {string|null} title.videoURL - the URL the page plays
 * @param {string|null} [title.mediaId] - its durable id ('mid:…'), which finds the row after a quality swap
 * @param {string|null} title.userId - the user the page was rendered for
 * @param {{ timeoutMs?: number, signal?: AbortSignal }} [options]
 * @returns {Promise<{ kind: 'row', playbackTime: number, completed: boolean }|{ kind: 'none' }|{ kind: 'unavailable' }>}
 */
export async function fetchServerResume({ videoURL = null, mediaId = null, userId = null } = {}, { timeoutMs = 1500, signal } = {}) {
  if (typeof fetch === 'undefined' || !videoURL) return UNAVAILABLE
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
  const onOuterAbort = () => controller?.abort()
  signal?.addEventListener?.('abort', onOuterAbort)
  try {
    const params = new URLSearchParams()
    if (typeof mediaId === 'string' && mediaId.startsWith('mid:')) params.set('mediaId', mediaId)
    params.set('videoId', videoURL)
    const res = await fetch(`/api/authenticated/sync/playback?${params}`, {
      cache: 'no-store',
      headers: playbackReadHeaders(userId),
      signal: controller?.signal,
    })
    if (!res.ok) return UNAVAILABLE
    const body = await res.json()
    if (!body?.found) return { kind: 'none' }
    return {
      kind: 'row',
      playbackTime: Number(body.playbackTime) || 0,
      completed: body.completed === true,
    }
  } catch {
    return UNAVAILABLE
  } finally {
    if (timer) clearTimeout(timer)
    signal?.removeEventListener?.('abort', onOuterAbort)
  }
}
