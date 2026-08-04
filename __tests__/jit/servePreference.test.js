import {
  isWebVisible,
  isBrowserPlayableUrl,
  visibleMovieFilter,
  visibleShowFilter,
  isShowWebVisible,
} from '@src/utils/mediaVisibility'
import { applyJitPreference, getJitServeMode, getEffectiveJitServeMode } from '@src/utils/jit/preference'
import { isTranscoderHealthy, _resetHealthCacheForTests } from '@src/utils/jit/health'
import { _setJitServeSettingsForTests } from '@src/utils/jit/serveSettings'
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
    expect(isWebVisible({ primaryContainer: 'mkv', jitUrl: JIT, jitEligible: true })).toBe(true)
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

  test('show-level visibility FAILS OPEN on the missing denormalized field', () => {
    // A show not yet re-synced since visibleEpisodeCount shipped must keep
    // status-quo behavior, not vanish from every rail until convergence.
    expect(isShowWebVisible({ title: 'Unconverged' })).toBe(true)
    expect(isShowWebVisible({ visibleEpisodeCount: null })).toBe(true)
    expect(isShowWebVisible({ visibleEpisodeCount: 0 })).toBe(false)
    expect(isShowWebVisible({ visibleEpisodeCount: 3 })).toBe(true)
    expect(isShowWebVisible(null)).toBe(false)
  })

  test('visibleShowFilter mirrors the fail-open predicate', () => {
    const f = visibleShowFilter()
    expect(f.$or).toHaveLength(2)
    expect(f.$or[0].visibleEpisodeCount.$gt).toBe(0)
    expect(f.$or[1].visibleEpisodeCount.$exists).toBe(false)
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

  const mkvMedia = () => ({ videoURL: 'https://h/movies/X/x.mkv', jitUrl: JIT, jitEligible: true })
  const mp4Media = () => ({ videoURL: 'https://h/movies/X/x.mp4', jitUrl: JIT, jitEligible: true })

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

  test('idempotent: a second application never clobbers rawVideoURL', async () => {
    process.env.JIT_SERVE_MODE = 'prefer'
    global.fetch = mockFetchOk()
    const m = await applyJitPreference(mkvMedia())
    expect(m.rawVideoURL).toBe('https://h/movies/X/x.mkv')
    const again = await applyJitPreference(m)
    expect(again.rawVideoURL).toBe('https://h/movies/X/x.mkv')
    expect(again.videoURL).toBe(JIT)
    expect(global.fetch).toHaveBeenCalledTimes(1)
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

describe('admin runtime override (settings > env > default)', () => {
  const origEnv = process.env.JIT_SERVE_MODE
  const origFetch = global.fetch

  afterEach(() => {
    process.env.JIT_SERVE_MODE = origEnv
    global.fetch = origFetch
    _setJitServeSettingsForTests(undefined)
    _resetHealthCacheForTests()
  })

  test('a valid runtime mode beats the env var', async () => {
    process.env.JIT_SERVE_MODE = 'prefer'
    _setJitServeSettingsForTests({ mode: 'off', maxQueued: null })
    expect(await getEffectiveJitServeMode()).toBe('off')
    // and the kill switch actually kills the swap
    global.fetch = mockFetchOk()
    const m = await applyJitPreference({ videoURL: 'https://h/x.mkv', jitUrl: JIT })
    expect(m.videoURL).toBe('https://h/x.mkv')
  })

  test('a null/invalid runtime mode falls back to env', async () => {
    process.env.JIT_SERVE_MODE = 'prefer'
    _setJitServeSettingsForTests({ mode: null, maxQueued: null })
    expect(await getEffectiveJitServeMode()).toBe('prefer')
    _setJitServeSettingsForTests({ mode: 'sideways', maxQueued: null })
    expect(await getEffectiveJitServeMode()).toBe('prefer')
  })

  test('no runtime settings at all falls back to env (test-env guard path)', async () => {
    process.env.JIT_SERVE_MODE = 'rescue'
    _setJitServeSettingsForTests(undefined)
    expect(await getEffectiveJitServeMode()).toBe('rescue')
  })

  test('per-media override "off" pins direct play even in prefer mode', async () => {
    process.env.JIT_SERVE_MODE = 'prefer'
    global.fetch = mockFetchOk()
    const m = await applyJitPreference({
      videoURL: 'https://h/x.mkv',
      jitUrl: JIT,
      jitEligible: true,
      jitServeOverride: 'off',
    })
    expect(m.videoURL).toBe('https://h/x.mkv')
    expect(m.playbackSource).toBeUndefined()
  })

  test('per-media override "on" serves JIT for a playable primary in rescue mode', async () => {
    process.env.JIT_SERVE_MODE = 'rescue'
    global.fetch = mockFetchOk()
    const m = await applyJitPreference({
      videoURL: 'https://h/x.mp4',
      jitUrl: JIT,
      jitEligible: true,
      jitServeOverride: 'on',
    })
    expect(m.videoURL).toBe(JIT)
    expect(m.rawVideoURL).toBe('https://h/x.mp4')
  })

  test('the global kill switch beats a per-media "on" override', async () => {
    process.env.JIT_SERVE_MODE = 'off'
    global.fetch = mockFetchOk()
    const m = await applyJitPreference({
      videoURL: 'https://h/x.mkv',
      jitUrl: JIT,
      jitServeOverride: 'on',
    })
    expect(m.videoURL).toBe('https://h/x.mkv')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  test('an "off" override neutralizes the jitUrl arm of visibility', () => {
    expect(isWebVisible({ primaryContainer: 'mkv', jitUrl: JIT, jitEligible: true })).toBe(true)
    expect(isWebVisible({ primaryContainer: 'mkv', jitUrl: JIT, jitEligible: true, jitServeOverride: 'off' })).toBe(false)
    // A playable primary stays visible regardless of the override.
    expect(isWebVisible({ primaryContainer: 'mp4', jitServeOverride: 'off' })).toBe(true)
    // The Mongo fragment mirrors the predicate.
    const arm = visibleMovieFilter().$or[0]
    expect(arm.jitServeOverride).toEqual({ $ne: 'off' })
  })

  test('addressable-but-ineligible (decoupled contract): default modes never swap', async () => {
    // Primate scenario: backend emits jitUrl for a multi-audio file with
    // jitEligible:false. prefer/rescue must NOT auto-accept the audio loss.
    process.env.JIT_SERVE_MODE = 'prefer'
    global.fetch = mockFetchOk()
    const m = await applyJitPreference({
      videoURL: 'https://h/movies/Primate/p.mp4',
      jitUrl: JIT,
      jitEligible: false,
    })
    expect(m.videoURL).toBe('https://h/movies/Primate/p.mp4')
    expect(m.playbackSource).toBeUndefined()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  test('missing jitEligible is treated as ineligible for default modes (fail-closed)', async () => {
    process.env.JIT_SERVE_MODE = 'prefer'
    global.fetch = mockFetchOk()
    const m = await applyJitPreference({ videoURL: 'https://h/x.mkv', jitUrl: JIT })
    expect(m.videoURL).toBe('https://h/x.mkv')
  })

  test('per-media "on" override consumes jitUrl despite jitEligible:false', async () => {
    // The explicit accept-the-loss switch — the whole point of decoupling.
    process.env.JIT_SERVE_MODE = 'rescue'
    global.fetch = mockFetchOk()
    const m = await applyJitPreference({
      videoURL: 'https://h/movies/Primate/p.mp4',
      jitUrl: JIT,
      jitEligible: false,
      jitServeOverride: 'on',
    })
    expect(m.videoURL).toBe(JIT)
    expect(m.rawVideoURL).toBe('https://h/movies/Primate/p.mp4')
    expect(m.playbackSource).toBe('jit')
  })

  test('visibility: addressable-but-ineligible is hidden unless overridden on', () => {
    // Default modes would refuse to swap it, so surfacing it is a dead-end.
    expect(isWebVisible({ primaryContainer: 'mkv', jitUrl: JIT, jitEligible: false })).toBe(false)
    expect(isWebVisible({ primaryContainer: 'mkv', jitUrl: JIT })).toBe(false)
    expect(
      isWebVisible({ primaryContainer: 'mkv', jitUrl: JIT, jitEligible: false, jitServeOverride: 'on' })
    ).toBe(true)
    // The Mongo fragment carries the matching nested $or.
    const arm = visibleMovieFilter().$or[0]
    expect(arm.$or).toEqual([{ jitEligible: true }, { jitServeOverride: 'on' }])
  })

  test('runtime maxQueued overrides the env ceiling in the health check', async () => {
    delete process.env.JIT_SERVE_MAX_QUEUED
    _setJitServeSettingsForTests({ mode: null, maxQueued: 2 })
    global.fetch = mockFetchOk({ status: 'healthy', queued: 5 })
    expect(await isTranscoderHealthy('https://t-override.example')).toBe(false)
    _resetHealthCacheForTests()
    global.fetch = mockFetchOk({ status: 'healthy', queued: 1 })
    expect(await isTranscoderHealthy('https://t-override.example')).toBe(true)
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
