'use client'

import useSWR from 'swr'

/** How often a visible page asks again. A hidden tab does not ask (refreshWhenHidden). */
export const POLL_MS = 15_000

const NOTHING = Object.freeze({ sessions: Object.freeze([]), offsetMs: 0 })

/**
 * The presence endpoint's URL for one page, or null when the page names
 * nothing to ask about (SWR then fetches nothing).
 *
 * @param {{ mediaId?: string|null, normalizedVideoId?: string|null, showId?: string|null, seasonNumber?: number|null }} filter
 * @returns {string|null}
 */
export function presenceUrl({ mediaId = null, normalizedVideoId = null, showId = null, seasonNumber = null } = {}) {
  const params = new URLSearchParams()
  if (showId) {
    params.set('showId', showId)
    if (Number.isInteger(seasonNumber)) params.set('season', String(seasonNumber))
  } else {
    if (mediaId) params.set('mediaId', mediaId)
    if (normalizedVideoId) params.set('normalizedVideoId', normalizedVideoId)
  }
  const query = params.toString()
  return query ? `/api/authenticated/presence?${query}` : null
}

/**
 * One poll. A refusal (signed out, not approved) is an answer, not an error:
 * it stops the polling. `offsetMs` is how far the server's clock is ahead of
 * this one, from the response's `asOf`.
 */
export async function fetchPresence(url) {
  const res = await fetch(url, { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } })
  if (res.status === 401 || res.status === 403) return { sessions: [], offsetMs: 0, refused: true }
  if (!res.ok) throw new Error(`Presence request failed (${res.status})`)
  const body = await res.json()
  const asOf = Date.parse(body?.asOf)
  return {
    sessions: Array.isArray(body?.sessions) ? body.sessions : [],
    offsetMs: Number.isFinite(asOf) ? asOf - Date.now() : 0,
    refused: false,
  }
}

/**
 * The viewer's own live sessions on this page's title, show or season, kept
 * current while the page is visible. Fetched on the client only: the media
 * pages are cached and prefetched shells, and this is per viewer and live.
 *
 * A failed poll reads as nothing live, never as the last answer: the line
 * disappears rather than keep saying "Playing" about a session it can no
 * longer see.
 *
 * @param {Parameters<typeof presenceUrl>[0]} filter
 * @returns {{ sessions: Array<Object>, offsetMs: number }}
 */
export default function useWatchingNow(filter) {
  const { data, error } = useSWR(presenceUrl(filter), fetchPresence, {
    refreshInterval: (latest) => (latest?.refused ? 0 : POLL_MS),
    refreshWhenHidden: false,
    revalidateOnFocus: true,
    // No faster than the poll itself (SWR backs off from here)
    errorRetryInterval: POLL_MS,
  })
  if (error || !data) return NOTHING
  return data
}
