/**
 * Thumbnail delivery classification — what turns a bare <track> failure into
 * an honest preview box.
 *
 * Worth protecting: (1) a 404 means "never", so it must stop retrying and
 * must not be reported as a failure; (2) a hung probe means the backend is
 * generating on this very request and must read as generating, not broken;
 * (3) progress is only ever a sane 0..1 or null, whatever the backend sent.
 */

import {
  classifyProbe,
  nextRetryDelay,
  probeThumbnailUrl,
} from '@components/MediaPlayer/thumbnailStatus'

describe('classifyProbe', () => {
  test('200 is ready, retried immediately', () => {
    expect(classifyProbe({ status: 200 })).toMatchObject({ state: 'ready', retryAfterMs: 0 })
  })

  test('202 is generating and honours Retry-After in seconds', () => {
    expect(classifyProbe({ status: 202, retryAfter: '12' })).toMatchObject({
      state: 'generating',
      retryAfterMs: 12_000,
    })
    expect(classifyProbe({ status: 202 })).toMatchObject({ state: 'generating', retryAfterMs: 5_000 })
  })

  test('202 carries progress, step and message through — sanitised', () => {
    const v = classifyProbe({
      status: 202,
      body: { progress: 0.42, step: 2, totalSteps: 3, message: 'Running FFmpeg' },
    })
    expect(v).toMatchObject({ progress: 0.42, step: 2, totalSteps: 3, message: 'Running FFmpeg' })

    // Out-of-range or wrong-typed fields never reach the UI.
    expect(classifyProbe({ status: 202, body: { progress: 1.7 } }).progress).toBeNull()
    expect(classifyProbe({ status: 202, body: { progress: '42%' } }).progress).toBeNull()
    expect(classifyProbe({ status: 202, body: { step: 0, totalSteps: -1 } })).toMatchObject({
      step: null,
      totalSteps: null,
    })
    expect(classifyProbe({ status: 202, body: { message: 'x'.repeat(500) } }).message).toBeNull()
  })

  test('404/410 is gone — a verdict, not a failure', () => {
    expect(classifyProbe({ status: 404 }).state).toBe('gone')
    expect(classifyProbe({ status: 410 }).state).toBe('gone')
  })

  test('5xx and anything else is failed', () => {
    for (const status of [500, 502, 504, 418]) {
      expect(classifyProbe({ status }).state).toBe('failed')
    }
  })

  test('a hung probe is the backend generating on this request', () => {
    expect(classifyProbe({ timedOut: true })).toMatchObject({ state: 'generating', retryAfterMs: 5_000 })
  })

  test('an unreachable proxy is network, not failed', () => {
    expect(classifyProbe({ networkError: true }).state).toBe('network')
  })
})

describe('nextRetryDelay', () => {
  test('gone and exhausted never retry', () => {
    expect(nextRetryDelay('gone', 0, 0, null)).toBeNull()
    expect(nextRetryDelay('exhausted', 0, 0, null)).toBeNull()
  })

  test('generating polls at Retry-After until a hard ceiling', () => {
    expect(nextRetryDelay('generating', 0, 0, 7_000)).toBe(7_000)
    expect(nextRetryDelay('generating', 50, 14 * 60_000, 7_000)).toBe(7_000)
    expect(nextRetryDelay('generating', 50, 15 * 60_000, 7_000)).toBeNull()
  })

  test('failed backs off slowly and gives up', () => {
    expect(nextRetryDelay('failed', 0, 0, null)).toBe(15_000)
    expect(nextRetryDelay('failed', 2, 0, null)).toBe(60_000)
    expect(nextRetryDelay('failed', 8, 0, null)).toBeNull()
  })

  test('network backs off faster and gives up sooner', () => {
    expect(nextRetryDelay('network', 0, 0, null)).toBe(3_000)
    expect(nextRetryDelay('network', 6, 0, null)).toBeNull()
  })
})

describe('probeThumbnailUrl', () => {
  const response = (status, { headers = {}, json } = {}) => ({
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    json: async () => {
      if (json === undefined) throw new Error('no body')
      return json
    },
  })

  test('reads Retry-After and the 202 body', async () => {
    const fetchImpl = async () =>
      response(202, { headers: { 'retry-after': '3' }, json: { progress: 0.5, step: 2, totalSteps: 3 } })
    const v = await probeThumbnailUrl('/x', fetchImpl)
    expect(v).toMatchObject({ state: 'generating', retryAfterMs: 3_000, progress: 0.5, step: 2 })
  })

  test('a 202 with an unparsable body is still generating', async () => {
    const v = await probeThumbnailUrl('/x', async () => response(202))
    expect(v).toMatchObject({ state: 'generating', progress: null })
  })

  test('a timeout classifies as generating, a network error as network', async () => {
    const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' })
    expect((await probeThumbnailUrl('/x', async () => { throw timeout })).state).toBe('generating')
    expect((await probeThumbnailUrl('/x', async () => { throw new TypeError('Failed to fetch') })).state).toBe('network')
  })
})

describe('overallProgress', () => {
  const { overallProgress: overall } = require('@components/MediaPlayer/thumbnailStatus')
  test('weights the three backend steps so extraction dominates', () => {
    expect(overall(1, 3, 0)).toBe(0)
    expect(overall(2, 3, 0)).toBeCloseTo(0.05)
    expect(overall(2, 3, 0.5)).toBeCloseTo(0.475)
    expect(overall(3, 3, 0)).toBeCloseTo(0.9)
    expect(overall(3, 3, 1)).toBe(1)
  })
  test('falls back to equal weights for an unknown step count, and null for garbage', () => {
    expect(overall(1, 2, 0.5)).toBeCloseTo(0.25)
    expect(overall(0, 3, 0.5)).toBeNull()
    expect(overall(2, 0, 0.5)).toBeNull()
  })
})

describe('failed honours the backend hold', () => {
  const { classifyProbe: c, nextRetryDelay: d } = require('@components/MediaPlayer/thumbnailStatus')
  test('Retry-After on a 5xx becomes the floor of the next delay', () => {
    const v = c({ status: 502, retryAfter: '60' })
    expect(v.retryAfterMs).toBe(60_000)
    expect(d('failed', 0, 0, v.retryAfterMs)).toBe(60_000)
  })
})
