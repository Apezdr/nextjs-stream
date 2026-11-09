/**
 * The Cast receiver's reporter: one writer of the position, and the only
 * writer of the cast's presence.
 *
 * While a sender is connected the sender's mirror owns the position, but its
 * tab can be throttled to a tick a minute in the background, which is no
 * cadence for "watching now". So the receiver reports presence either way,
 * marking its reports presence-only while a sender is there, and ends the row
 * itself: at the stop, the end of the title, shutdown, and when another title
 * or person loads over the top.
 */
import { startPlaybackReporter } from '../../public/receiver/js/playback-reporter.js'

const PlayerState = { IDLE: 'IDLE', PLAYING: 'PLAYING', PAUSED: 'PAUSED', BUFFERING: 'BUFFERING' }
const EventType = {
  PLAYER_LOAD_COMPLETE: 'PLAYER_LOAD_COMPLETE',
  MEDIA_INFORMATION_CHANGED: 'MEDIA_INFORMATION_CHANGED',
  PAUSE: 'PAUSE',
  SEEKED: 'SEEKED',
  MEDIA_FINISHED: 'MEDIA_FINISHED',
  REQUEST_STOP: 'REQUEST_STOP',
}
const SystemEventType = { SENDER_DISCONNECTED: 'SENDER_DISCONNECTED', SHUTDOWN: 'SHUTDOWN' }

const VIDEO_A = 'https://files.example.com/a/master.m3u8'
const VIDEO_B = 'https://files.example.com/b/master.m3u8'

let player
let receiver
let sent
let responses

function emit(listeners, type, event) {
  for (const listener of listeners[type] || []) listener(event)
}

/** Let a response's promise chain (fetch, then json, then the snapshot) settle. */
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

function load(videoId, token) {
  player.media = { contentUrl: videoId, customData: token ? { castToken: token } : {} }
  emit(player.listeners, EventType.PLAYER_LOAD_COMPLETE)
}

beforeEach(() => {
  jest.useFakeTimers()
  global.cast = {
    framework: {
      events: { EventType },
      messages: { PlayerState },
      system: { EventType: SystemEventType },
    },
  }

  player = {
    listeners: {},
    media: null,
    state: PlayerState.PLAYING,
    time: 600,
    addEventListener(type, fn) {
      ;(this.listeners[type] ||= []).push(fn)
    },
    getMediaInformation() {
      return this.media
    },
    getPlayerState() {
      return this.state
    },
    getCurrentTimeSec() {
      return this.time
    },
  }
  receiver = {
    listeners: {},
    senders: [],
    addEventListener(type, fn) {
      ;(this.listeners[type] ||= []).push(fn)
    },
    getSenders() {
      return this.senders
    },
  }

  // Every report, fetch or beacon, in the order it went out.
  sent = []
  responses = []
  global.fetch = jest.fn((url, init) => {
    sent.push({ via: 'fetch', url, body: JSON.parse(init.body), keepalive: init.keepalive })
    const next = responses.shift()
    return next ?? Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) })
  })
  global.Blob = class {
    constructor(parts) {
      this.parts = parts
    }
  }
  Object.defineProperty(global.navigator, 'sendBeacon', {
    configurable: true,
    value: jest.fn((url, blob) => {
      sent.push({ via: 'beacon', url, body: JSON.parse(blob.parts[0]) })
      return true
    }),
  })

  startPlaybackReporter({ context: receiver, playerManager: player, castDebugLogger: null, logTag: 't' })
})

afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
  delete global.cast
  delete global.navigator.sendBeacon
})

describe('reporting', () => {
  it('with no sender, reports the position, which also keeps the cast live', () => {
    load(VIDEO_A, 'token-a')
    jest.advanceTimersByTime(5000)

    expect(sent).toHaveLength(1)
    const [{ url, body }] = sent
    expect(url).toBe('/api/cast/playback')
    expect(body).toMatchObject({ token: 'token-a', videoId: VIDEO_A, playbackTime: 600, isPaused: false })
    expect(body.castSessionId).toMatch(/^[A-Za-z0-9-]{1,64}$/)
    expect(body).not.toHaveProperty('presenceOnly')
    expect(body).not.toHaveProperty('final')
  })

  it('with a sender connected, still reports, but presence only: the sender owns the position', () => {
    receiver.senders = [{ id: 'phone' }]
    load(VIDEO_A, 'token-a')
    jest.advanceTimersByTime(5000)

    expect(sent).toHaveLength(1)
    expect(sent[0].body).toMatchObject({ playbackTime: 600, presenceOnly: true })
  })

  it('checks in inside the contract: every 15-20 s playing, every 2 min paused', () => {
    load(VIDEO_A, 'token-a')
    jest.advanceTimersByTime(60_000)
    const playing = sent.length
    expect(playing).toBeGreaterThanOrEqual(3) // 60 s / 20 s worst case

    player.state = PlayerState.PAUSED
    emit(player.listeners, EventType.PAUSE)
    const atPause = sent.length
    expect(sent.at(-1).body.isPaused).toBe(true)
    jest.advanceTimersByTime(119_000)
    expect(sent.length).toBe(atPause)
    jest.advanceTimersByTime(6_000)
    expect(sent.length).toBe(atPause + 1)
  })

  it('an idle player reports nothing, so a finished title never reads as playing', () => {
    load(VIDEO_A, 'token-a')
    player.state = PlayerState.IDLE
    jest.advanceTimersByTime(60_000)
    expect(sent).toHaveLength(0)
  })

  it('a load with no token reports nothing at all', () => {
    load(VIDEO_A, null)
    jest.advanceTimersByTime(60_000)
    expect(sent).toHaveLength(0)
  })
})

describe('ending the cast', () => {
  it('a stop is final: it carries the last position and ends the presence row', () => {
    receiver.senders = [{ id: 'phone' }] // a final report is the last word, sender or not
    load(VIDEO_A, 'token-a')
    emit(player.listeners, EventType.REQUEST_STOP)

    expect(sent).toHaveLength(1)
    expect(sent[0].via).toBe('beacon')
    expect(sent[0].body).toMatchObject({ token: 'token-a', playbackTime: 600, final: true })
    expect(sent[0].body).not.toHaveProperty('presenceOnly')
  })

  it('a final report with no position worth saving still goes, to end the row', () => {
    load(VIDEO_A, 'token-a')
    player.time = 1
    emit(player.listeners, EventType.MEDIA_FINISHED, { currentMediaTime: 1 })

    expect(sent).toHaveLength(1)
    expect(sent[0].body).toMatchObject({ token: 'token-a', videoId: VIDEO_A, final: true })
    expect(sent[0].body).not.toHaveProperty('playbackTime')
  })

  it('another title loading over the top ends the outgoing row with the outgoing token', () => {
    load(VIDEO_A, 'token-a')
    jest.advanceTimersByTime(5000)
    const outgoing = sent[0].body.castSessionId

    load(VIDEO_B, 'token-b')
    const end = sent.at(-1).body
    expect(end).toEqual(
      expect.objectContaining({ token: 'token-a', videoId: VIDEO_A, castSessionId: outgoing, final: true })
    )

    jest.advanceTimersByTime(15_000)
    const next = sent.at(-1).body
    expect(next).toMatchObject({ token: 'token-b', videoId: VIDEO_B })
    expect(next.castSessionId).not.toBe(outgoing)
  })

  it('a later status for the same title keeps the same row', () => {
    load(VIDEO_A, 'token-a')
    jest.advanceTimersByTime(5000)
    const id = sent[0].body.castSessionId
    emit(player.listeners, EventType.MEDIA_INFORMATION_CHANGED)
    jest.advanceTimersByTime(15_000)
    expect(sent.every(({ body }) => !body.final)).toBe(true)
    expect(sent.at(-1).body.castSessionId).toBe(id)
  })
})

describe('the previous token never comes back', () => {
  it('a refresh still adopted for the current title', async () => {
    let answer
    responses.push(new Promise((resolve) => (answer = resolve)))
    load(VIDEO_A, 'token-a')
    jest.advanceTimersByTime(5000)
    answer({ ok: true, status: 200, json: async () => ({ ok: true, token: 'token-a-rolled' }) })
    await settle()

    jest.advanceTimersByTime(15_000)
    expect(sent.at(-1).body.token).toBe('token-a-rolled')
  })

  it('a status change after a refresh is not a new load: same row, rolled token kept', async () => {
    let answer
    responses.push(new Promise((resolve) => (answer = resolve)))
    load(VIDEO_A, 'token-a')
    jest.advanceTimersByTime(5000)
    const id = sent[0].body.castSessionId
    answer({ ok: true, status: 200, json: async () => ({ ok: true, token: 'token-a-rolled' }) })
    await settle()

    // The loaded media still carries the token it was loaded with.
    emit(player.listeners, EventType.MEDIA_INFORMATION_CHANGED)
    jest.advanceTimersByTime(15_000)
    expect(sent.some(({ body }) => body.final)).toBe(false)
    expect(sent.at(-1).body).toMatchObject({ token: 'token-a-rolled', castSessionId: id })
  })

  it('a refresh that answers a report for the previous title is not adopted', async () => {
    let answer
    responses.push(new Promise((resolve) => (answer = resolve)))
    load(VIDEO_A, 'token-a')
    jest.advanceTimersByTime(5000) // report for A, response held

    load(VIDEO_B, 'token-b')
    answer({ ok: true, status: 200, json: async () => ({ ok: true, token: 'token-a-rolled' }) })
    await settle()

    jest.advanceTimersByTime(15_000)
    expect(sent.at(-1).body.token).toBe('token-b')
  })

  it('a rejection of the previous token does not silence the new one', async () => {
    let answer
    responses.push(new Promise((resolve) => (answer = resolve)))
    load(VIDEO_A, 'token-a')
    jest.advanceTimersByTime(5000)

    load(VIDEO_B, 'token-b')
    answer({ ok: false, status: 403, json: async () => ({}) })
    await settle()

    const before = sent.length
    jest.advanceTimersByTime(15_000)
    expect(sent.length).toBeGreaterThan(before)
    expect(sent.at(-1).body.token).toBe('token-b')
  })
})
