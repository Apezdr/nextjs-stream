'use client'

import { fetchWithETag } from '@src/utils/conditionalFetch'
import { playbackReadHeaders } from '@src/lib/playbackUser'
import { isOnTitle, livePosition } from '@src/utils/playbackPresence/rules'
import { observeOwnLiveSessions } from '@components/WatchingNow/ownSessions'

/** The channel every tab of this browser shares. A change to a message's shape takes a new name. */
export const PLAYBACK_CHANNEL = 'nextjs-stream.playback.v1'

/** A surface that mounts over a snapshot older than this asks again: the bound on a page the router replays. */
export const SUBSCRIBE_STALE_MS = 30_000
/** A tab that comes back (visible, focused, online, restored) asks again past this. */
export const RETURN_STALE_MS = 5_000
/** A playing tab tells the others where it is this often at most, and at once on pause, unpause and seek. */
export const POSITION_EVERY_MS = 5_000
/** A position this far from where steady playback would have reached is a seek. */
const SEEK_JUMP_S = 5
/** Another tab's playing entry not heard from for this long is gone by the next snapshot. */
const REMOTE_SILENCE_MS = 15_000

const POSITIONS_URL = '/api/authenticated/sync/positions'
const PLAYBACK_URL = '/api/authenticated/sync/playback'

/** The session is not this page's user's any more (or nobody's): nothing more is asked. */
const REFUSALS = new Set([401, 403, 409])

/**
 * What the store says about one title. `answer`:
 *  - 'pending': nothing is known yet (also the server render, and a title with no identity)
 *  - 'found':   `entry` holds the position
 *  - 'none':    the server was asked about this title and has no row for it
 *  - 'unknown': the store could not find out: the read failed, or was
 *               refused (`refusal` is then the status: 401, 403 or 409)
 * Never "no progress" for a read that did not happen.
 */
export const PENDING = Object.freeze({ answer: 'pending', entry: null, refusal: null })
const NONE = Object.freeze({ answer: 'none', entry: null, refusal: null })
const UNKNOWN = Object.freeze({ answer: 'unknown', entry: null, refusal: null })

const isDurable = (id) => typeof id === 'string' && id.startsWith('mid:')
const text = (value) => (typeof value === 'string' && value ? value : null)
const serverTime = (value) => {
  const at = value ? Date.parse(value) : NaN
  return Number.isFinite(at) ? at : 0
}

/** The keys a title is filed under: its durable id first, then the hash of its file. */
function keysOf(mediaId, normalizedVideoId) {
  const keys = []
  if (isDurable(mediaId)) keys.push(`m:${mediaId}`)
  if (text(normalizedVideoId)) keys.push(`n:${normalizedVideoId}`)
  return keys
}

function find(map, mediaId, normalizedVideoId) {
  return (isDurable(mediaId) && map.get(`m:${mediaId}`)) || (text(normalizedVideoId) && map.get(`n:${normalizedVideoId}`)) || null
}

function row({ mediaId, normalizedVideoId, playbackTime, lastUpdated }) {
  return Object.freeze({
    source: 'row',
    mediaId: isDurable(mediaId) ? mediaId : null,
    normalizedVideoId: text(normalizedVideoId),
    playbackTime: Number.isFinite(playbackTime) ? playbackTime : 0,
    lastUpdated: lastUpdated ?? null,
    at: serverTime(lastUpdated),
  })
}

function browserDocument() {
  return typeof document !== 'undefined' ? document : null
}

function browserWindow() {
  return typeof window !== 'undefined' ? window : null
}

function browserFetch(...args) {
  return fetch(...args)
}

function browserChannel(name) {
  return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(name)
}

function randomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
}

/**
 * The signed-in user's positions, in memory, for every progress surface of
 * the page: rail cards, hover popups, grid posters, episode rows, the details
 * pages' button, panel and bar. It replaces the copy the browser used to keep
 * in its own storage, which named titles and no user, outlived the session,
 * and was compared by the browser's clock.
 *
 * - **For display only.** The record is the server's row. Nothing here is a
 *   place to resume from (the player asks the server), and nothing is written
 *   to any browser storage: the store lives as long as the document.
 * - **One user.** The first page part that names its user fixes it (the
 *   layout, a details page's seed, a player). Every request names that user
 *   and the server refuses one whose session is someone else's. A refusal, or
 *   a part of the page rendered for another user, empties the store for good:
 *   a document does not change accounts.
 * - **Filled by one request**, `GET /sync/positions` (the 200 most recent
 *   rows of the last 30 days), and refreshed by events, never a timer:
 *     1. a surface subscribes and there is no snapshot, or it is 30 s old;
 *     2. the tab becomes visible, gains focus, comes back online or is
 *        restored from the back/forward cache, and the snapshot is 5 s old;
 *     3. playback ended or a position was changed by hand, in any tab;
 *     4. one of the viewer's own live sessions elsewhere disappeared.
 *   A hidden tab asks nothing; what it missed is asked for when it is shown.
 * - **A title outside the snapshot** is asked for by itself, once
 *   (`GET /sync/playback`), by a surface that has nothing else to go on: the
 *   details pages (`want`). Their server render also hands the answer in with
 *   the page (`seed`).
 * - **Tabs tell each other** over a BroadcastChannel what they are playing
 *   (`position`), that they stopped (`ended`) and that a position was set by
 *   hand (`changed`). Without BroadcastChannel each tab works alone and
 *   catches up when it is next shown. There is no `storage`-event fallback:
 *   it would put positions back into storage the whole browser shares.
 * - **No client clock is compared with anything.** A row carries the
 *   server's `lastUpdated`, an answer the server's `asOf`; `now` here only
 *   measures intervals (how old the snapshot is, how long since a tab spoke).
 *
 * What one title shows, first match wins (`getTitle`):
 *   1. what a tab of this browser is playing, or just played until the next
 *      snapshot has it;
 *   2. one of the viewer's own live sessions on another device, from the
 *      presence store when a surface is polling it (no request is added);
 *   3. the server's row: from the snapshot, or the title's own answer if newer.
 * A surface then sets that against the `watchHistory` object it was rendered
 * with: both carry the server's clock, and the newer wins (useLiveProgress).
 *
 * A factory so tests get their own; the app uses `playbackStore` below.
 *
 * @param {Object} [options]
 * @param {(url: string, init?: Object) => Promise<{ response: { status: number, ok: boolean }, data: any }>} [options.conditionalFetch] - the snapshot request (If-None-Match kept per URL)
 * @param {typeof fetch} [options.fetchImpl] - one title's request
 * @param {() => Document|null} [options.getDocument]
 * @param {() => Window|null} [options.getWindow]
 * @param {(name: string) => BroadcastChannel|null} [options.createChannel]
 * @param {{ observe: (observer: (answer: { sessions: Array<Object>, offsetMs: number }) => void) => unknown }|null} [options.presence]
 * @param {() => number} [options.now] - ms, for intervals only
 * @param {string} [options.tabId]
 */
export function createPlaybackStore({
  conditionalFetch = fetchWithETag,
  fetchImpl = browserFetch,
  getDocument = browserDocument,
  getWindow = browserWindow,
  createChannel = browserChannel,
  presence = null,
  now = () => Date.now(),
  tabId = randomId(),
} = {}) {
  let userId = null
  let status = 'idle'
  let asOf = null
  let refusal = null
  let refusedState = null

  // The snapshot's rows, each under its durable id and its file's hash
  let rows = new Map()
  // One title's own answer (a seed, a single read, a save's answer): { row|null, failed, asOf, staleSeq }
  const answers = new Map()
  // What a tab of this browser is playing: { view, tabId, heardAt, heardSeq, endedSeq }
  const live = new Map()
  // The viewer's own live sessions, as last told by the presence store
  let presenceViews = []
  // The presence sessions that are tabs of this browser (they say so on the channel)
  const browserSessions = new Set()
  // Titles a surface asked about that nothing has answered yet
  const wanted = new Map()
  // Where and when this tab last told the others it is, per title
  const outbox = new Map()

  // Snapshot requests are numbered: what a request started before an event
  // answers says nothing about the event
  let started = 0
  let succeeded = 0
  let answeredAt = 0
  let dirty = false
  let inflight = null
  let again = false

  let channel = null
  let attached = false
  const listeners = new Set()
  const foundStates = new WeakMap()

  function emit() {
    for (const listener of listeners) listener()
  }

  function found(entry) {
    let state = foundStates.get(entry)
    if (!state) {
      state = Object.freeze({ answer: 'found', entry, refusal: null })
      foundStates.set(entry, state)
    }
    return state
  }

  function visible() {
    return getDocument()?.visibilityState !== 'hidden'
  }

  // --- what a title shows --------------------------------------------------

  function presenceOn(mediaId, normalizedVideoId) {
    if (presenceViews.length === 0) return null
    const title = { mediaId, normalizedVideoId }
    // Ranked by the server: playing before paused, then the newest heartbeat.
    // A tab of this browser speaks for itself (`live`), and once it has
    // stopped, its session in an answer up to a poll old says nothing.
    return presenceViews.find((view) => !browserSessions.has(view.session.sessionId) && isOnTitle(view.session, title)) ?? null
  }

  /** The server's row for a title: the snapshot's, or the title's own answer when that is the newer word. */
  function storedRow(snapshotRow, answer) {
    if (!answer || answer.failed) return snapshotRow
    // Asked, and there was none: a row written since is the news
    if (!answer.row) return snapshotRow && snapshotRow.at > answer.asOf ? snapshotRow : null
    if (!snapshotRow) return answer.row
    return answer.row.at > snapshotRow.at ? answer.row : snapshotRow
  }

  /**
   * @param {string|null} mediaId - the durable id ('mid:…'), when the surface has one
   * @param {string|null} normalizedVideoId - the hash of the title's file, as the server gave it
   * @returns {{ answer: 'pending'|'found'|'none'|'unknown', entry: { source: 'live'|'presence'|'row', playbackTime: number, at?: number|null }|null, refusal: number|null }}
   *   the same object until something about this title changes
   */
  function getTitle(mediaId, normalizedVideoId) {
    const mid = isDurable(mediaId) ? mediaId : null
    const nid = text(normalizedVideoId)
    if (!mid && !nid) return PENDING
    if (refusal !== null) return refusedState

    const playing = find(live, mid, nid)
    if (playing) return found(playing.view)

    const session = presenceOn(mid, nid)
    const answer = find(answers, mid, nid)
    const stored = storedRow(find(rows, mid, nid), answer)
    // The session as last polled, or the row, whichever the server wrote
    // later: a paused device holds a position as old as its pause, and a
    // device that just stopped is still in an answer up to a poll old
    if (session && (!stored || (session.at !== null && session.at >= stored.at))) return found(session)
    if (stored) return found(stored)
    if (answer) return answer.failed ? UNKNOWN : NONE
    return PENDING
  }

  // --- the user -------------------------------------------------------------

  function refuse(code) {
    refusal = code
    status = 'refused'
    refusedState = Object.freeze({ answer: 'unknown', entry: null, refusal: code })
    rows = new Map()
    answers.clear()
    live.clear()
    wanted.clear()
    outbox.clear()
    browserSessions.clear()
    presenceViews = []
    try {
      channel?.close()
    } catch {
      // already closed
    }
    channel = null
    detach()
    emit()
  }

  /**
   * Names the user a part of the page was rendered for. The first fixes the
   * store's user; another user's means the account changed under this
   * document, and the store holds nothing from then on.
   *
   * @returns {boolean} whether that user is the store's
   */
  function identify(id) {
    const next = id === null || id === undefined || id === '' ? null : String(id)
    if (!next || refusal !== null) return false
    if (userId === null) {
      userId = next
      openChannel()
      presence?.observe?.(onPresence)
      if (listeners.size > 0) onSubscribe()
      askWanted()
      return true
    }
    if (userId !== next) {
      refuse(409)
      return false
    }
    return true
  }

  // --- the snapshot ---------------------------------------------------------

  function install(data, seq) {
    const previous = rows
    const next = new Map()
    let changed = false
    for (const raw of Array.isArray(data?.rows) ? data.rows : []) {
      const keys = keysOf(raw?.mediaId, raw?.normalizedVideoId)
      if (keys.length === 0) continue
      const held = previous.get(keys[0])
      // The same object for an unchanged row, so its surfaces do not render again
      const kept =
        held && held.playbackTime === raw.playbackTime && held.lastUpdated === (raw.lastUpdated ?? null) && held.mediaId === (isDurable(raw.mediaId) ? raw.mediaId : null) && held.normalizedVideoId === text(raw.normalizedVideoId)
          ? held
          : row(raw)
      // Newest first: the first row filed under a key is the one a title gets
      for (const key of keys) {
        if (next.has(key)) continue
        next.set(key, kept)
        if (previous.get(key) !== kept) changed = true
      }
    }
    if (next.size !== previous.size) changed = true
    rows = next
    if (typeof data?.asOf === 'string') asOf = data.asOf
    status = 'ready'
    answeredAt = now()
    succeeded = seq
    dirty = false

    // What this snapshot now carries, it replaces
    for (const [key, entry] of live) {
      const ended = entry.endedSeq !== null && entry.endedSeq < seq
      const gone = entry.tabId !== tabId && entry.heardSeq < seq && (entry.view.paused || now() - entry.heardAt > REMOTE_SILENCE_MS)
      if (ended || gone) {
        live.delete(key)
        changed = true
      }
    }
    for (const [key, answer] of answers) {
      if (answer.staleSeq !== null && answer.staleSeq < seq) {
        answers.delete(key)
        changed = true
      }
    }
    if (changed) emit()
  }

  /**
   * Asks for the snapshot. One request at a time; a hidden tab asks nothing
   * and catches up when shown.
   *
   * @param {{ after?: boolean }} [options] - `after`: an event just happened that a request already in flight may predate, so ask once more behind it
   */
  function refresh({ after = false } = {}) {
    if (userId === null || refusal !== null) return Promise.resolve()
    if (!visible()) {
      dirty = true
      return Promise.resolve()
    }
    if (inflight) {
      if (after) again = true
      return inflight
    }
    const seq = ++started
    if (status !== 'ready') status = 'loading'
    inflight = (async () => {
      try {
        const { response, data } = await conditionalFetch(POSITIONS_URL, {
          credentials: 'include',
          headers: playbackReadHeaders(userId),
        })
        if (REFUSALS.has(response.status)) return refuse(response.status)
        if ((!response.ok && response.status !== 304) || !data) throw new Error(`Positions request failed (${response.status})`)
        // The answer says whose rows these are: another account's are never held
        if (String(data.userId) !== userId) return refuse(409)
        install(data, seq)
      } catch {
        // Not "nothing watched": the rows held stay as they were, and with none held the store says it failed
        if (status !== 'ready') status = 'failed'
      } finally {
        inflight = null
        if (again) {
          again = false
          refresh()
        }
        askWanted()
      }
    })()
    return inflight
  }

  function stale(olderThanMs) {
    return dirty || answeredAt === 0 || now() - answeredAt >= olderThanMs
  }

  // Trigger 3 and 4: something changed that the snapshot held does not have
  function invalidate() {
    if (userId === null || refusal !== null) return
    dirty = true
    if (listeners.size > 0) refresh({ after: true })
  }

  // Trigger 1
  function onSubscribe() {
    if (stale(SUBSCRIBE_STALE_MS)) refresh()
  }

  // Trigger 2
  function onReturn() {
    if (!visible()) return
    if (stale(RETURN_STALE_MS)) refresh()
    else askWanted()
  }

  function onPageShow(event) {
    if (event?.persisted) onReturn()
  }

  function attach() {
    if (attached) return
    attached = true
    getDocument()?.addEventListener('visibilitychange', onReturn)
    const win = getWindow()
    win?.addEventListener('focus', onReturn)
    win?.addEventListener('online', onReturn)
    win?.addEventListener('pageshow', onPageShow)
  }

  function detach() {
    if (!attached) return
    attached = false
    getDocument()?.removeEventListener('visibilitychange', onReturn)
    const win = getWindow()
    win?.removeEventListener('focus', onReturn)
    win?.removeEventListener('online', onReturn)
    win?.removeEventListener('pageshow', onPageShow)
  }

  function subscribe(listener) {
    listeners.add(listener)
    if (listeners.size === 1 && refusal === null) attach()
    // React reads the snapshot again after subscribing, so nothing is emitted here
    onSubscribe()
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) detach()
    }
  }

  // --- one title's own answer ----------------------------------------------

  /** Files an answer about one title, unless a newer one is held. Both times are the server's. */
  function putAnswer(title, { row: answered = null, asOf: answeredAsOf = 0, failed = false }) {
    const keys = keysOf(title?.mediaId, title?.normalizedVideoId)
    // Under the row's own keys too: the server may have found it by another arm than the page's ids
    if (answered) for (const key of keysOf(answered.mediaId, answered.normalizedVideoId)) if (!keys.includes(key)) keys.push(key)
    if (keys.length === 0) return false
    const held = keys.map((key) => answers.get(key)).find(Boolean)
    if (held && !held.failed) {
      // A read that failed says nothing against an answer; nor does an older answer (a page the router replayed)
      if (failed || held.asOf > answeredAsOf) return false
    }
    const answer = { row: answered, failed, asOf: answeredAsOf, staleSeq: null }
    for (const key of keys) answers.set(key, answer)
    emit()
    return true
  }

  async function askTitle(title) {
    const params = new URLSearchParams()
    if (isDurable(title.mediaId)) params.set('mediaId', title.mediaId)
    if (title.videoURL) params.set('videoId', title.videoURL)
    title.asking = true
    title.askedSeq = started
    try {
      const response = await fetchImpl(`${PLAYBACK_URL}?${params}`, {
        credentials: 'include',
        cache: 'no-store',
        headers: playbackReadHeaders(userId),
      })
      if (REFUSALS.has(response.status)) return refuse(response.status)
      if (!response.ok) throw new Error(`Position request failed (${response.status})`)
      const body = await response.json()
      putAnswer(title, {
        row: body?.found ? row(body) : null,
        asOf: serverTime(body?.asOf),
      })
    } catch {
      putAnswer(title, { failed: true })
    } finally {
      title.asking = false
    }
  }

  // The snapshot comes first: most titles a viewer opens are in it. A title
  // whose read failed is asked again after a later snapshot, not on a timer.
  function askWanted() {
    if (userId === null || refusal !== null || inflight || !visible()) return
    if (status !== 'ready' && status !== 'failed') return
    for (const [key, title] of wanted) {
      if (title.asking) continue
      const answer = find(answers, title.mediaId, title.normalizedVideoId)
      if (find(rows, title.mediaId, title.normalizedVideoId) || (answer && !answer.failed)) {
        wanted.delete(key)
        continue
      }
      if (title.askedSeq !== null && title.askedSeq >= succeeded) continue
      askTitle(title)
    }
  }

  /**
   * A surface with nothing else to go on (a details page: its HTML is shared
   * by every viewer) needs an answer for its title. Asked of the server once,
   * and only when neither the snapshot nor a seed has the title.
   *
   * @param {{ mediaId?: string|null, normalizedVideoId?: string|null, videoURL?: string|null }} title
   */
  function want({ mediaId = null, normalizedVideoId = null, videoURL = null } = {}) {
    const keys = keysOf(mediaId, normalizedVideoId)
    // The route takes a durable id or a URL; an answer is filed by the ids
    if (keys.length === 0 || (!isDurable(mediaId) && !videoURL)) return
    if (refusal !== null || wanted.has(keys[0])) return
    wanted.set(keys[0], { mediaId, normalizedVideoId, videoURL, asking: false, askedSeq: null })
    askWanted()
  }

  /**
   * The answer a page's server render read for its title, handed in with the
   * page. `entry` is what GET /sync/playback answers: `found`, the row's keys,
   * `playbackTime`, `lastUpdated`, and `asOf`.
   */
  function seed({ userId: pageUser = null, title = null, entry = null } = {}) {
    if (!identify(pageUser) || !entry) return
    putAnswer(title, { row: entry.found ? row(entry) : null, asOf: serverTime(entry.asOf) })
  }

  // --- what the tabs of this browser are playing -----------------------------

  function setLive({ mediaId, normalizedVideoId, playbackTime, paused, sessionId = null }, fromTab, ended = false) {
    const keys = keysOf(mediaId, normalizedVideoId)
    if (keys.length === 0 || !Number.isFinite(playbackTime)) return
    if (text(sessionId)) {
      // Bounded: a tab opens a handful of sessions in its life
      if (browserSessions.size >= 64) browserSessions.delete(browserSessions.values().next().value)
      browserSessions.add(sessionId)
    }
    const held = find(live, mediaId, normalizedVideoId)
    const same = held && held.view.playbackTime === playbackTime && held.view.paused === (paused === true) && held.view.ended === ended
    const view = same ? held.view : Object.freeze({ source: 'live', playbackTime, paused: paused === true, ended })
    const entry = { view, tabId: fromTab, heardAt: now(), heardSeq: started, endedSeq: ended ? started : null }
    for (const key of keys) live.set(key, entry)
    if (!same) emit()
  }

  function endLive({ mediaId, normalizedVideoId, playbackTime, sessionId = null }, fromTab) {
    const held = find(live, mediaId, normalizedVideoId)
    // Two tabs on one title: the one still playing keeps the entry
    if (held && held.tabId !== fromTab && !held.view.ended) return
    const position = Number.isFinite(playbackTime) ? playbackTime : held?.view.playbackTime
    setLive({ mediaId, normalizedVideoId, playbackTime: position, paused: true, sessionId }, fromTab, true)
  }

  function applyChanged(keys) {
    let dropped = false
    for (const title of Array.isArray(keys) ? keys : []) {
      for (const key of keysOf(title?.mediaId, title?.normalizedVideoId ?? title?.nid)) {
        if (live.delete(key)) dropped = true
        // The title's own answer is old news now: the next snapshot has the last word
        const answer = answers.get(key)
        if (answer) answer.staleSeq = started
      }
    }
    if (dropped) emit()
  }

  function onMessage(event) {
    const message = event?.data
    if (!message || typeof message !== 'object' || message.v !== 1) return
    // Another user's tab (an account switched elsewhere) says nothing to this page
    if (userId === null || message.userId !== userId || !message.tabId || message.tabId === tabId) return
    const title = { mediaId: message.mediaId ?? null, normalizedVideoId: message.nid ?? null, sessionId: message.sessionId ?? null }
    if (message.type === 'position') {
      setLive({ ...title, playbackTime: message.playbackTime, paused: message.paused === true }, message.tabId)
    } else if (message.type === 'ended') {
      endLive({ ...title, playbackTime: message.playbackTime }, message.tabId)
      invalidate()
    } else if (message.type === 'changed') {
      applyChanged(message.keys)
      invalidate()
    }
  }

  function openChannel() {
    if (channel) return
    try {
      channel = createChannel(PLAYBACK_CHANNEL)
      channel?.addEventListener('message', onMessage)
    } catch {
      // No channel: this tab works alone and catches up when it is next shown
      channel = null
    }
  }

  function post(message) {
    try {
      channel?.postMessage({ v: 1, userId, tabId, ...message })
    } catch {
      // The other tabs catch up on their next refresh
    }
  }

  /**
   * This tab's player is at `playbackTime`. Call it as often as the position
   * is known: the other tabs (and this one's surfaces) are told every
   * POSITION_EVERY_MS at most, and at once on pause, unpause and seek.
   * `sessionId` is the player's presence session, so no tab takes that
   * session for another device.
   */
  function reportPosition({ userId: pageUser = null, mediaId = null, normalizedVideoId = null, playbackTime, paused = false, sessionId = null } = {}) {
    if (!Number.isFinite(playbackTime) || !identify(pageUser)) return
    const keys = keysOf(mediaId, normalizedVideoId)
    if (keys.length === 0) return
    const isPaused = paused === true
    const last = outbox.get(keys[0])
    const at = now()
    const expected = last ? last.playbackTime + (last.paused ? 0 : (at - last.at) / 1000) : 0
    const due = !last || last.paused !== isPaused || at - last.at >= POSITION_EVERY_MS || Math.abs(playbackTime - expected) > SEEK_JUMP_S
    if (!due) return
    outbox.set(keys[0], { at, playbackTime, paused: isPaused })
    setLive({ mediaId, normalizedVideoId, playbackTime, paused: isPaused, sessionId }, tabId)
    post({ type: 'position', mediaId: isDurable(mediaId) ? mediaId : null, nid: text(normalizedVideoId), playbackTime, paused: isPaused, sessionId: text(sessionId) })
  }

  /**
   * This tab's player stopped (unmount, the page leaving, a cast taking the
   * title over). Its last position stays on show until a snapshot asked for
   * after this has the server's.
   */
  function reportEnded({ userId: pageUser = null, mediaId = null, normalizedVideoId = null, playbackTime = null, sessionId = null } = {}) {
    if (!identify(pageUser)) return
    const keys = keysOf(mediaId, normalizedVideoId)
    if (keys.length === 0) return
    outbox.delete(keys[0])
    endLive({ mediaId, normalizedVideoId, playbackTime, sessionId }, tabId)
    post({
      type: 'ended',
      mediaId: isDurable(mediaId) ? mediaId : null,
      nid: text(normalizedVideoId),
      playbackTime: Number.isFinite(playbackTime) ? playbackTime : null,
      sessionId: text(sessionId),
    })
    invalidate()
  }

  /**
   * A position was set by something other than a player in this tab, and the
   * server has it: Mark watched (with its title in `keys`), or a cast that
   * ended (no keys: the sender knows the receiver's URL, not the title's ids).
   * `saved` is the row as the save's answer gave it, shown at once.
   *
   * @param {Object} change
   * @param {string|null} change.userId - the user the page was rendered for
   * @param {Array<{ mediaId?: string|null, normalizedVideoId?: string|null }>} [change.keys]
   * @param {{ mediaId?: string|null, normalizedVideoId?: string|null, playbackTime: number, savedAt: string }|null} [change.saved]
   */
  function reportChanged({ userId: pageUser = null, keys = [], saved = null } = {}) {
    if (!identify(pageUser)) return
    applyChanged(keys)
    if (saved && saved.savedAt && Number.isFinite(saved.playbackTime)) {
      const savedRow = row({ ...saved, lastUpdated: saved.savedAt })
      putAnswer(saved, { row: savedRow, asOf: savedRow.at })
    }
    post({
      type: 'changed',
      keys: (Array.isArray(keys) ? keys : []).map((title) => ({
        mediaId: isDurable(title?.mediaId) ? title.mediaId : null,
        nid: text(title?.normalizedVideoId),
      })),
    })
    invalidate()
  }

  // --- the viewer's own sessions elsewhere -----------------------------------

  function onPresence(answer) {
    if (refusal !== null) return
    const sessions = Array.isArray(answer?.sessions) ? answer.sessions : []
    // The server's clock, as the presence store measured it
    const serverNow = now() + (Number.isFinite(answer?.offsetMs) ? answer.offsetMs : 0)
    const before = presenceViews
    presenceViews = sessions.flatMap((session) => {
      const playbackTime = livePosition(session, serverNow)
      if (!Number.isFinite(playbackTime)) return []
      const at = serverTime(session.positionAt)
      return [Object.freeze({ source: 'presence', playbackTime, playing: session.state === 'playing', at: at || null, sessionId: session.id ?? null, session })]
    })
    // Trigger 4: a session that was live is gone, and its last position is on the server
    if (before.some((old) => !presenceViews.some((view) => view.sessionId === old.sessionId))) invalidate()
    if (before.length > 0 || presenceViews.length > 0) emit()
  }

  return {
    subscribe,
    getTitle,
    identify,
    want,
    seed,
    reportPosition,
    reportEnded,
    reportChanged,
    refresh,
    /** For tests and diagnostics; surfaces read `getTitle`. */
    getState: () => ({ userId, status, asOf, refusal }),
  }
}

/**
 * The app's one store. Created with no user: on the server it is shared by
 * every request and must hold nothing, so only effects and event handlers
 * (which run in the browser) ever write to it.
 */
export const playbackStore = createPlaybackStore({ presence: { observe: observeOwnLiveSessions } })
