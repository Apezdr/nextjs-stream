/**
 * The Cast volume queue.
 *
 * What it must guarantee: a flood of slider writes reaches the receiver as a
 * few non-overlapping requests that END WITH THE FINAL VALUE (an AVR's Cast
 * firmware landed on an intermediate level when they overlapped); a dropped
 * final request is re-sent; and it never owns `volume` when not casting, since
 * that would point the page's own volume at the television.
 */

jest.mock('@src/components/MediaPlayer/videojs', () => ({
  __esModule: true,
  Player: { usePlayer: () => 'disconnected' },
  usePlayerContext: () => ({}),
}))
jest.mock('@components/Cast/useCastSession', () => ({ __esModule: true, useCastAdoption: () => ({ adopted: false }) }))

// A receiver whose acknowledgements the test releases by hand.
let mockSession
let mockRemotePlayer
jest.mock('@components/Cast/castSdk', () => ({
  __esModule: true,
  getContext: () => ({ getCurrentSession: () => mockSession }),
  getRemote: () => ({ player: mockRemotePlayer }),
}))

import { CastVolumeQueue, meterSegments, stepLevel } from '@src/components/MediaPlayer/CastVolume'

function makeReceiver({ step = 1 / 15 } = {}) {
  const sent = []
  const pending = []
  mockRemotePlayer = { volumeLevel: 0.5 }
  mockSession = {
    setVolume: (level) => {
      sent.push(level)
      return new Promise((resolve) => pending.push(() => resolve()))
    },
    getVolume: () => mockRemotePlayer.volumeLevel,
    getSessionObj: () => ({ receiver: { volume: { stepInterval: step } } }),
  }
  /** Acknowledge the oldest request; `apply` sets the receiver's level as if it obeyed. */
  const ack = async ({ apply = true } = {}) => {
    const resolve = pending.shift()
    if (apply) mockRemotePlayer.volumeLevel = sent[sent.length - pending.length - 1]
    resolve?.()
    await flush()
  }
  return { sent, pending, ack }
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

function makeTarget() {
  const seen = []
  const el = new EventTarget()
  const dispatch = el.dispatchEvent.bind(el)
  el.dispatchEvent = (event) => {
    seen.push(event.type)
    return dispatch(event)
  }
  return { el, seen }
}

function enabledQueue() {
  const target = makeTarget()
  const q = new CastVolumeQueue()
  q.attach({ media: target.el })
  q.setEnabled(true)
  target.seen.length = 0
  return { q, target }
}

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

describe('ownership', () => {
  it('owns nothing until casting, and hands volume back when casting ends', () => {
    makeReceiver()
    const target = makeTarget()
    const q = new CastVolumeQueue()
    q.attach({ media: target.el })
    expect(q.mediaOverride).toBeNull()

    q.setEnabled(true)
    expect(q.mediaOverride.volume).toBe(0.5)
    q.setEnabled(false)
    expect(q.mediaOverride).toBeNull()
    // Each change of owner makes the store re-read volume: on the way out it
    // is what puts the slider back on the local element's level.
    expect(target.seen).toEqual(['volumechange', 'volumechange'])
  })
})

describe('the queue', () => {
  // Advance fake time and let acknowledgement promises run.
  const tick = async (ms) => {
    jest.advanceTimersByTime(ms)
    await flush()
  }
  // Levels compared on the receiver's 1/15 grid, without float noise.
  const steps = (levels) => levels.map((v) => Math.round(v * 15))

  it('sends a flick as ONE request, the final value, once the slider is still', async () => {
    const rx = makeReceiver()
    const { q } = enabledQueue()

    // A quick flick from 100% to 15%: thirty writes in a burst.
    for (let i = 0; i <= 29; i++) q.mediaOverride.volume = 1 - (0.85 * i) / 29
    expect(rx.sent).toEqual([]) // nothing while the slider moves
    await tick(249)
    expect(rx.sent).toEqual([])
    await tick(1)
    expect(steps(rx.sent)).toEqual([2]) // 15% snapped to the nearest 1/15 step

    await rx.ack()
    await tick(2000)
    expect(rx.sent).toHaveLength(1) // and nothing after it
  })

  it('still updates the receiver about once a second during one long drag', async () => {
    const rx = makeReceiver()
    const { q } = enabledQueue()

    // A slow drag: a write every 50 ms for 2.5 s, acknowledged at once.
    for (let t = 0; t < 2500; t += 50) {
      q.mediaOverride.volume = 1 - t / 5000
      await tick(50)
      if (rx.pending.length) await rx.ack()
    }
    await tick(250)
    if (rx.pending.length) await rx.ack()
    expect(rx.sent.length).toBeGreaterThanOrEqual(2)
    expect(rx.sent.length).toBeLessThanOrEqual(4)
    expect(steps(rx.sent).at(-1)).toBe(8) // ends on the final value, 0.51 → 8/15
  })

  it('keeps one request in flight and sends only the newest after it', async () => {
    const rx = makeReceiver()
    const { q } = enabledQueue()

    q.mediaOverride.volume = 0.32
    await tick(250)
    expect(steps(rx.sent)).toEqual([5])
    q.mediaOverride.volume = 0.45 // while the first is still unacknowledged
    q.mediaOverride.volume = 0.6
    await tick(1000)
    expect(rx.sent).toHaveLength(1)
    await rx.ack()
    await tick(250)
    expect(steps(rx.sent)).toEqual([5, 9])
  })

  it('snaps to the receiver step, and leaves levels alone when it reports none', async () => {
    const rx = makeReceiver({ step: 0.05 })
    const { q } = enabledQueue()
    q.mediaOverride.volume = 0.37
    expect(q.mediaOverride.volume).toBeCloseTo(0.35) // the slider settles on the step
    await tick(250)
    expect(rx.sent[0]).toBeCloseTo(0.35)

    const plain = makeReceiver({ step: null })
    const { q: q2 } = enabledQueue()
    q2.mediaOverride.volume = 0.37
    await tick(250)
    expect(plain.sent).toEqual([0.37])
  })

  it('does not send a level the receiver already reports', async () => {
    const rx = makeReceiver()
    mockRemotePlayer.volumeLevel = 0.6 // exactly 9/15
    const { q, target } = enabledQueue()

    q.mediaOverride.volume = 0.61 // snaps back to 9/15
    await tick(250 + 600)
    expect(rx.sent).toEqual([])
    expect(target.seen.at(-1)).toBe('volumechange') // still settles
  })

  it('reads back the requested level while pending, then the receiver once settled', async () => {
    const rx = makeReceiver()
    const { q, target } = enabledQueue()

    q.mediaOverride.volume = 0.8
    mockRemotePlayer.volumeLevel = 0.2 // an echo of an older level
    expect(q.mediaOverride.volume).toBeCloseTo(0.8)

    await tick(250)
    await rx.ack() // the receiver obeys
    await tick(600)
    expect(q.mediaOverride.volume).toBeCloseTo(0.8)
    expect(target.seen.at(-1)).toBe('volumechange') // settled: the store re-reads
  })

  it('re-sends the final level when the receiver ends up elsewhere, at most twice', async () => {
    const rx = makeReceiver()
    const { q } = enabledQueue()

    q.mediaOverride.volume = 0.15
    await tick(250)
    for (let round = 0; round < 3; round++) {
      await rx.ack({ apply: false }) // acknowledged, but the AVR dropped it
      mockRemotePlayer.volumeLevel = 0.4
      await tick(600 + 250)
    }
    expect(steps(rx.sent)).toEqual([2, 2, 2])
  })

  it('treats anything within half a receiver step as arrived', async () => {
    const rx = makeReceiver({ step: 1 / 15 })
    const { q } = enabledQueue()

    q.mediaOverride.volume = 0.15
    await tick(250)
    await rx.ack({ apply: false })
    mockRemotePlayer.volumeLevel = 0.15 // within half a step of 2/15
    await tick(600 + 250)
    expect(rx.sent).toHaveLength(1)
  })

  it('does not stall on a request the receiver never answers', async () => {
    const rx = makeReceiver()
    const { q } = enabledQueue()

    q.mediaOverride.volume = 0.32
    await tick(250)
    q.mediaOverride.volume = 0.6
    await tick(2000) // no acknowledgement ever comes
    await tick(250)
    expect(steps(rx.sent)).toEqual([5, 9])
  })

  it('drops pending work when casting ends, and ignores a late acknowledgement', async () => {
    const rx = makeReceiver()
    const { q } = enabledQueue()

    q.mediaOverride.volume = 0.32
    await tick(250)
    q.mediaOverride.volume = 0.6
    q.setEnabled(false)
    await rx.ack()
    await tick(5000)
    expect(rx.sent).toHaveLength(1)
  })
})

describe('step controls', () => {
  const step = 1 / 15

  it('moves exactly one receiver step, from wherever the level is, within 0..1', () => {
    expect(Math.round(stepLevel(7 / 15, step, 1) * 15)).toBe(8)
    expect(Math.round(stepLevel(7 / 15, step, -1) * 15)).toBe(6)
    expect(Math.round(stepLevel(0.21, step, 1) * 15)).toBe(4) // off-grid snaps first: 0.21 ≈ 3/15
    expect(stepLevel(1, step, 1)).toBe(1)
    expect(stepLevel(0, step, -1)).toBe(0)
  })

  it('lights one meter segment per step', () => {
    expect(meterSegments(0.2, step)).toEqual({ count: 15, lit: 3 })
    expect(meterSegments(1, step)).toEqual({ count: 15, lit: 15 })
    expect(meterSegments(0, 0.05)).toEqual({ count: 20, lit: 0 })
    expect(meterSegments(NaN, step)).toEqual({ count: 15, lit: 0 })
  })
})
