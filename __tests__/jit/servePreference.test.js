import {
  isWebVisible,
  isBrowserPlayableUrl,
  visibleMovieFilter,
} from '@src/utils/mediaVisibility'
import { applyJitPreference, getJitServeMode } from '@src/utils/jit/preference'
import { isTranscoderHealthy, _resetHealthCacheForTests } from '@src/utils/jit/health'
import { generateNormalizedVideoId } from '@src/utils/videoIdentity'

const JIT = 'https://transcoder.example.com/stream/bW92aWVzL1gvWC5ta3Y/master.m3u8'

const mockFetchOk = (body = { status: 'healthy', queued: 0 }) =>
  jest.fn().mockResolvedValue({ ok: true, json: async () => body })

describe('mediaVisibility', () => {
  test('browser-playable containers pass, mkv/avi fail', () => {
    expect(isWebVisible({ primaryContainer: 'mp4' })).toBe(true)
    expect(isWebVisible({ primaryContainer: 'webm' })).toBe(true)
    expect(isWebVisible({ primaryContainer: 'MOV' })).toBe(true)
    expect(isWebVisible({ primaryContainer: 'mkv' })).toBe(false)
    expect(isWebVisible({ primaryContainer: 'avi' })).toBe(false)
  })

  test('jitUrl presence rescues a non-playable container', () => {
    expect(isWebVisible({ primaryContainer: 'mkv', jitUrl: JIT })).toBe(true)
    expect(isWebVisible({ primaryContainer: 'mkv', jitUrl: '' })).toBe(false)
    expect(isWebVisible({ primaryContainer: 'mkv', jitUrl: null })).toBe(false)
  })

  test('legacy docs fall back to the videoURL suffix', () => {
    expect(isWebVisible({ videoURL: 'https://h/movies/X/x.mp4' })).toBe(true)
    expect(isWebVisible({ videoURL: 'https://h/movies/X/x.mp4?token=1' })).toBe(true)
    expect(isWebVisible({ videoURL: 'https://h/movies/X/x.mkv' })).toBe(false)
  })

  test('fail-closed: no signals means hidden', () => {
    expect(isWebVisible({})).toBe(false)
    expect(isWebVisible(null)).toBe(false)
    expect(isWebVisible({ videoURL: null })).toBe(false)
  })

  test('the Mongo fragment mirrors the predicate for representative docs', () => {
    // Sanity of shape only (no mongo here): every $or arm corresponds to a
    // predicate branch — jitUrl string, sargable container, legacy suffix.
    const f = visibleMovieFilter()
    expect(f.$or).toHaveLength(3)
    expect(f.$or[0].jitUrl).toBeDefined()
    expect(f.$or[1].primaryContainer.$in).toContain('mp4')
    expect(f.$or[2].videoURL).toBeInstanceOf(RegExp)
  })

  test('isBrowserPlayableUrl ignores query and fragment', () => {
    expect(isBrowserPlayableUrl('https://h/x.m4v#t=30')).toBe(true)
    expect(isBrowserPlayableUrl('https://h/x.m3u8')).toBe(false)
    expect(isBrowserPlayableUrl(undefined)).toBe(false)
  })
})

describe('identity invariance of the serve-time swap (the load-bearing pin)', () => {
  test('Kingdom of Heaven pair: hash(jitUrl) === hash(rawVideoURL)', () => {
    // Serving either URL must key watch history identically, or flipping
    // JIT_SERVE_MODE forks user progress. Production-captured pair.
    const jit =
      'https://transcoder.adamdrumm.com/stream/bW92aWVzL0tpbmdkb20gb2YgSGVhdmVuL0tpbmdkb20ub2YuSGVhdmVuLjIwMDUuREMuNEsuSERSLkRWLjIxNjBwLkJEUmVtdXguSXRhLkVuZy54MjY1LU5BSE9NLm1rdg/master.m3u8'
    const raw =
      'https://personalserver.adamdrumm.com/movies/Kingdom%20of%20Heaven/Kingdom.of.Heaven.2005.DC.4K.HDR.DV.2160p.BDRemux.Ita.Eng.x265-NAHOM.mkv'
    expect(generateNormalizedVideoId(jit)).toBe(generateNormalizedVideoId(raw))
  })
})

describe('applyJitPreference', () => {
  const origEnv = process.env.JIT_SERVE_MODE
  const origFetch = global.fetch

  afterEach(() => {
    process.env.JIT_SERVE_MODE = origEnv
    global.fetch = origFetch
    _resetHealthCacheForTests()
  })

  const mkvMedia = () => ({ videoURL: 'https://h/movies/X/x.mkv', jitUrl: JIT })
  const mp4Media = () => ({ videoURL: 'https://h/movies/X/x.mp4', jitUrl: JIT })

  test('rescue mode swaps a non-playable primary when healthy', async () => {
    process.env.JIT_SERVE_MODE = 'rescue'
    global.fetch = mockFetchOk()
    const m = await applyJitPreference(mkvMedia())
    expect(m.videoURL).toBe(JIT)
    expect(m.rawVideoURL).toBe('https://h/movies/X/x.mkv')
    expect(m.playbackSource).toBe('jit')
  })

  test('rescue mode leaves a browser-playable primary alone', async () => {
    process.env.JIT_SERVE_MODE = 'rescue'
    global.fetch = mockFetchOk()
    const m = await applyJitPreference(mp4Media())
    expect(m.videoURL).toBe('https://h/movies/X/x.mp4')
    expect(m.playbackSource).toBeUndefined()
  })

  test('prefer mode swaps playable primaries too', async () => {
    process.env.JIT_SERVE_MODE = 'prefer'
    global.fetch = mockFetchOk()
    const m = await applyJitPreference(mp4Media())
    expect(m.videoURL).toBe(JIT)
    expect(m.rawVideoURL).toBe('https://h/movies/X/x.mp4')
  })

  test('off mode never swaps', async () => {
    process.env.JIT_SERVE_MODE = 'off'
    global.fetch = mockFetchOk()
    const m = await applyJitPreference(mkvMedia())
    expect(m.videoURL).toBe('https://h/movies/X/x.mkv')
  })

  test('unhealthy transcoder falls back to direct', async () => {
    process.env.JIT_SERVE_MODE = 'prefer'
    global.fetch = jest.fn().mockResolvedValue({ ok: false })
    const m = await applyJitPreference(mkvMedia())
    expect(m.videoURL).toBe('https://h/movies/X/x.mkv')
    expect(m.playbackSource).toBeUndefined()
  })

  test('probe failure (network error) falls back to direct', async () => {
    process.env.JIT_SERVE_MODE = 'prefer'
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const m = await applyJitPreference(mkvMedia())
    expect(m.videoURL).toBe('https://h/movies/X/x.mkv')
  })

  test('no jitUrl is a no-op regardless of mode', async () => {
    process.env.JIT_SERVE_MODE = 'prefer'
    global.fetch = mockFetchOk()
    const m = await applyJitPreference({ videoURL: 'https://h/x.mkv', jitUrl: null })
    expect(m.videoURL).toBe('https://h/x.mkv')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  test('default mode is rescue; unrecognized fails closed to off', async () => {
    delete process.env.JIT_SERVE_MODE
    expect(getJitServeMode()).toBe('rescue')
    process.env.JIT_SERVE_MODE = 'aggressive'
    expect(getJitServeMode()).toBe('off')
  })
})

describe('isTranscoderHealthy', () => {
  const origFetch = global.fetch
  const origEnv = process.env.JIT_SERVE_MAX_QUEUED

  afterEach(() => {
    global.fetch = origFetch
    process.env.JIT_SERVE_MAX_QUEUED = origEnv
    _resetHealthCacheForTests()
  })

  test('caches healthy results (single probe for repeated calls)', async () => {
    global.fetch = mockFetchOk()
    await isTranscoderHealthy('https://t1.example')
    await isTranscoderHealthy('https://t1.example')
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  test('queue ceiling sheds when configured and exceeded', async () => {
    process.env.JIT_SERVE_MAX_QUEUED = '2'
    global.fetch = mockFetchOk({ status: 'healthy', queued: 5 })
    expect(await isTranscoderHealthy('https://t2.example')).toBe(false)
    _resetHealthCacheForTests()
    global.fetch = mockFetchOk({ status: 'healthy', queued: 1 })
    expect(await isTranscoderHealthy('https://t2.example')).toBe(true)
  })

  test('no ceiling configured means liveness-only (queue ignored)', async () => {
    delete process.env.JIT_SERVE_MAX_QUEUED
    global.fetch = mockFetchOk({ status: 'healthy', queued: 99 })
    expect(await isTranscoderHealthy('https://t3.example')).toBe(true)
  })

  test('empty origin is unhealthy without probing', async () => {
    global.fetch = mockFetchOk()
    expect(await isTranscoderHealthy('')).toBe(false)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
