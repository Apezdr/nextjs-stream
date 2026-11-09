'use client'

import { useSyncExternalStore } from 'react'

/** How often a visible page asks again. */
export const POLL_MS = 15_000

const PRESENCE_URL = '/api/authenticated/presence'

/** Nothing live: the answer before the first poll, after a failed one, and after a refusal. */
export const NOTHING = Object.freeze({ sessions: Object.freeze([]), offsetMs: 0 })

// The clock offset wobbles by the round trip; less than this is the same answer
const OFFSET_SLACK_MS = 1000

function browserDocument() {
  return typeof document !== 'undefined' ? document : null
}

function browserFetch(...args) {
  return fetch(...args)
}

/**
 * The viewer's own live sessions, for every presence surface on a web page:
 * the media pages' "watching now" line, the cards' badge and the hover
 * popup. One poll per page however many of them are mounted, and none while
 * nothing is mounted or the tab is hidden. Each surface picks its own
 * sessions with the shared rules (playbackPresence/rules.js).
 *
 * - Unfiltered `GET /api/authenticated/presence`: a user has a handful of
 *   live sessions at most, so one answer serves every title on the page.
 * - A failed poll reads as nothing live, never as the last answer.
 * - A 401 or 403 stops the polling until the page reloads.
 * - An answer older than one poll is dropped when the first surface mounts
 *   after a gap, so a client navigation never shows a session that may have
 *   ended meanwhile.
 * - `offsetMs` is how far the server's clock is ahead of this one (from the
 *   response's `asOf`), for ticking a playing position.
 *
 * A factory so tests get their own; the app uses the one below.
 *
 * @param {{ fetchImpl?: typeof fetch, getDocument?: () => Document|null, now?: () => number, pollMs?: number }} [options]
 */
export function createOwnSessionsStore({
  fetchImpl = browserFetch,
  getDocument = browserDocument,
  now = () => Date.now(),
  pollMs = POLL_MS,
} = {}) {
  let snapshot = NOTHING
  let answeredAt = 0
  let refused = false
  let inflight = null
  let timer = null
  const listeners = new Set()

  function set(next) {
    if (next === snapshot) return
    snapshot = next
    for (const listener of listeners) listener()
  }

  function settle(sessions, offsetMs) {
    if (sessions.length === 0) return set(NOTHING)
    const same =
      Math.abs(snapshot.offsetMs - offsetMs) < OFFSET_SLACK_MS &&
      JSON.stringify(snapshot.sessions) === JSON.stringify(sessions)
    if (!same) set(Object.freeze({ sessions, offsetMs }))
  }

  function visible() {
    return getDocument()?.visibilityState !== 'hidden'
  }

  function stopTimer() {
    if (timer) clearInterval(timer)
    timer = null
  }

  function startTimer() {
    if (!timer && !refused) timer = setInterval(poll, pollMs)
  }

  function poll() {
    if (refused) return Promise.resolve()
    if (inflight) return inflight
    inflight = (async () => {
      try {
        const res = await fetchImpl(PRESENCE_URL, {
          credentials: 'include',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        })
        if (res.status === 401 || res.status === 403) {
          refused = true
          stopTimer()
          set(NOTHING)
          return
        }
        if (!res.ok) throw new Error(`Presence request failed (${res.status})`)
        const body = await res.json()
        answeredAt = now()
        const asOf = Date.parse(body?.asOf)
        settle(Array.isArray(body?.sessions) ? body.sessions : [], Number.isFinite(asOf) ? asOf - answeredAt : 0)
      } catch {
        answeredAt = 0
        set(NOTHING)
      } finally {
        inflight = null
      }
    })()
    return inflight
  }

  function stale() {
    return now() - answeredAt >= pollMs
  }

  function onVisibilityChange() {
    if (!visible()) return stopTimer()
    if (stale()) poll()
    startTimer()
  }

  function subscribe(listener) {
    listeners.add(listener)
    if (listeners.size === 1) {
      // React re-reads the snapshot after subscribing, so no emit is needed here
      if (stale()) snapshot = NOTHING
      getDocument()?.addEventListener('visibilitychange', onVisibilityChange)
      if (visible()) {
        if (stale()) poll()
        startTimer()
      }
    }
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) {
        stopTimer()
        getDocument()?.removeEventListener('visibilitychange', onVisibilityChange)
      }
    }
  }

  return { subscribe, getSnapshot: () => snapshot, poll }
}

const ownSessions = createOwnSessionsStore()

function getServerSnapshot() {
  return NOTHING
}

/**
 * The viewer's own live sessions, ranked, and the server clock's offset.
 * Nothing on the server render and before the first answer.
 *
 * @returns {{ sessions: ReadonlyArray<Object>, offsetMs: number }}
 */
export function useOwnLiveSessions() {
  return useSyncExternalStore(ownSessions.subscribe, ownSessions.getSnapshot, getServerSnapshot)
}
