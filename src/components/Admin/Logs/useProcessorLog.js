'use client'

import { useEffect, useEffectEvent, useReducer } from 'react'
import { buildURL } from '@src/utils'

const PAGE_SIZE = 500
const LIVE_INTERVAL_MS = 5000
// Live lines past this many drop the oldest; "Load older" brings them back.
const MAX_ENTRIES = 5000

const NO_ENTRIES = Object.freeze([])

/**
 * The newest page's URL for this server and these filters. It also keys the
 * log state: older pages and live lines extend it with `before` / `after`.
 */
function newestPageUrl(serverId, { category, level, q }) {
  const params = new URLSearchParams({ server: serverId, limit: String(PAGE_SIZE) })
  if (category) params.set('category', category)
  if (level) params.set('level', level)
  if (q) params.set('q', q)
  return buildURL(`/api/authenticated/admin/logs?${params}`)
}

async function fetchLogPage(url, signal) {
  const response = await fetch(url, { signal, cache: 'no-store' })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(body?.error || body?.message || `The log request failed (HTTP ${response.status})`)
  }
  return body
}

const initialState = {
  key: null,
  status: 'idle', // 'loading' | 'ready' | 'error'
  entries: NO_ENTRIES,
  older: null, // cursor for the page before the first entry; null at the start of the log
  newer: null, // cursor the live view reads on from
  scannedFrom: null, // how far back the reads looked, for "no matches since …"
  categories: NO_ENTRIES,
  loadingOlder: false,
  error: null,
  olderError: null,
  liveError: null,
  skipped: false, // the live view fell more than a page behind and left lines out
  restarted: false, // the log started over under the live view (the processor restarted)
}

function reducer(state, action) {
  if (action.type === 'start') {
    return { ...initialState, key: action.key, status: 'loading', categories: state.categories }
  }
  // A response for filters the page has since left.
  if (action.key !== state.key) return state

  const { page } = action
  switch (action.type) {
    case 'newest':
      return {
        ...state,
        status: 'ready',
        entries: page.entries,
        older: page.older,
        newer: page.newer,
        scannedFrom: page.scannedFrom,
        categories: page.categories,
      }
    case 'failed':
      return { ...state, status: 'error', error: action.error }
    case 'olderStart':
      return { ...state, loadingOlder: true, olderError: null }
    case 'older':
      // Live trimming moved the cursor while this page was loading.
      if (action.before !== state.older) return { ...state, loadingOlder: false }
      return {
        ...state,
        loadingOlder: false,
        entries: [...page.entries, ...state.entries],
        older: page.older,
        scannedFrom: page.scannedFrom ?? state.scannedFrom,
      }
    case 'olderFailed':
      return { ...state, loadingOlder: false, olderError: action.error }
    case 'live': {
      if (action.after !== state.newer) return state
      if (page.reset) {
        return {
          ...state,
          entries: page.entries,
          older: page.older,
          newer: page.newer,
          scannedFrom: page.scannedFrom,
          categories: page.categories,
          liveError: null,
          restarted: true,
        }
      }
      if (page.entries.length === 0) {
        return page.newer === state.newer && state.liveError === null
          ? state
          : { ...state, newer: page.newer, liveError: null }
      }
      let entries = [...state.entries, ...page.entries]
      let older = state.older
      if (entries.length > MAX_ENTRIES) {
        entries = entries.slice(entries.length - MAX_ENTRIES)
        // Each id is a log cursor, so the dropped lines are the page before it.
        older = entries[0].id
      }
      return {
        ...state,
        entries,
        older,
        newer: page.newer,
        categories: page.categories,
        liveError: null,
        skipped: state.skipped || page.truncated,
      }
    }
    case 'liveFailed':
      return { ...state, liveError: action.error }
    default:
      throw new Error(`Unknown log action: ${action.type}`)
  }
}

/**
 * One processor's log through /api/authenticated/admin/logs: the newest page
 * for the filters, older pages on request, and (while `live`) new lines every
 * few seconds from the last cursor.
 *
 * @param {{ serverId: string | null, filters: { category?: string, level?: string, q?: string }, live: boolean }} options
 */
export function useProcessorLog({ serverId, filters, live }) {
  const key = serverId ? newestPageUrl(serverId, filters) : null
  const [state, dispatch] = useReducer(reducer, initialState)
  const [reloadCount, reload] = useReducer((count) => count + 1, 0)

  useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    dispatch({ type: 'start', key })
    fetchLogPage(key, controller.signal).then(
      (page) => dispatch({ type: 'newest', key, page }),
      (error) => {
        if (!controller.signal.aborted) dispatch({ type: 'failed', key, error: error.message })
      }
    )
    return () => controller.abort()
  }, [key, reloadCount])

  const pollLive = useEffectEvent(async (signal) => {
    if (state.status !== 'ready' || !state.newer) return
    const after = state.newer
    try {
      const page = await fetchLogPage(`${key}&after=${encodeURIComponent(after)}`, signal)
      dispatch({ type: 'live', key, after, page })
    } catch (error) {
      if (!signal.aborted) dispatch({ type: 'liveFailed', key, error: error.message })
    }
  })

  useEffect(() => {
    if (!live || !key) return
    const controller = new AbortController()
    let timer
    const tick = async () => {
      // A hidden tab skips its turn rather than reading the log for no one.
      if (document.visibilityState === 'visible') await pollLive(controller.signal)
      if (!controller.signal.aborted) timer = setTimeout(tick, LIVE_INTERVAL_MS)
    }
    timer = setTimeout(tick, LIVE_INTERVAL_MS)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [live, key])

  async function loadOlder() {
    const before = state.older
    if (!before || state.loadingOlder) return
    dispatch({ type: 'olderStart', key })
    try {
      const page = await fetchLogPage(`${key}&before=${encodeURIComponent(before)}`)
      dispatch({ type: 'older', key, before, page })
    } catch (error) {
      dispatch({ type: 'olderFailed', key, error: error.message })
    }
  }

  return { ...state, reload, loadOlder }
}
