import {
  parseStreamUrl,
  deriveOriginalLabel,
  reasonToUserCopy,
  enrichDirectInfo,
  fetchDirectInfo,
  _resetDirectInfoCacheForTests,
} from '@src/utils/jit/directInfo'

const ORIGIN = 'https://transcoder.example.com'
const KEY = 'bW92aWVzL1gvWC5ta3Y'
const MASTER = `${ORIGIN}/stream/${KEY}/master.m3u8`

const OFFERED = {
  hls: {
    offered: true,
    variantIndex: 6,
    codecs: 'hvc1.2.4.L123.B0',
    bandwidth: 41500000,
    videoRange: 'PQ',
    supplementalCodecs: 'dvh1.08.06/db1p',
  },
  file: { available: true, sizeBytes: 29400000000, container: 'mp4', videoCodec: 'hevc' },
}

const WITHHELD = {
  hls: { offered: false, reason: 'open-gop-avc' },
  file: { available: true, sizeBytes: 29400000000, container: 'mp4', videoCodec: 'h264' },
}

const okResponse = (body) => ({ ok: true, status: 200, json: async () => body })

beforeEach(() => {
  _resetDirectInfoCacheForTests()
})

describe('parseStreamUrl', () => {
  test('splits every tail the transcoder serves under a key', () => {
    expect(parseStreamUrl(MASTER)).toEqual({ origin: ORIGIN, key: KEY })
    expect(parseStreamUrl(`${ORIGIN}/stream/${KEY}/manifest.mpd`)).toEqual({
      origin: ORIGIN,
      key: KEY,
    })
    expect(parseStreamUrl(`${ORIGIN}/stream/${KEY}/file`)).toEqual({ origin: ORIGIN, key: KEY })
  })

  test('a tier-mutated master still names the same key', () => {
    expect(parseStreamUrl(`${MASTER}?direct=1`)).toEqual({ origin: ORIGIN, key: KEY })
  })

  test('url-safe base64 keys survive; the standard alphabet is tolerated', () => {
    expect(parseStreamUrl(`${ORIGIN}/stream/a-b_c/master.m3u8`)?.key).toBe('a-b_c')
    expect(parseStreamUrl(`${ORIGIN}/stream/a+b==/master.m3u8`)?.key).toBe('a+b==')
  })

  test('anything that is not a transcoder stream URL is refused', () => {
    expect(parseStreamUrl('https://files.example.com/movies/X/X.mp4')).toBeNull()
    expect(parseStreamUrl(`${ORIGIN}/stream/${KEY}/v/2/index.m3u8`)).toBeNull()
    expect(parseStreamUrl(`${ORIGIN}/stream//master.m3u8`)).toBeNull()
    expect(parseStreamUrl('file:///etc/passwd')).toBeNull()
    expect(parseStreamUrl('not a url')).toBeNull()
    expect(parseStreamUrl(null)).toBeNull()
    expect(parseStreamUrl(undefined)).toBeNull()
    expect(parseStreamUrl('')).toBeNull()
  })
})

describe('display mapping', () => {
  test('Dolby Vision outranks HDR10, which outranks plain Original', () => {
    expect(deriveOriginalLabel(OFFERED.hls)).toBe('Original (Dolby Vision)')
    expect(deriveOriginalLabel({ offered: true, videoRange: 'PQ' })).toBe('Original (HDR10)')
    expect(deriveOriginalLabel({ offered: true, videoRange: 'SDR' })).toBe('Original')
    expect(deriveOriginalLabel({})).toBe('Original')
  })

  test('every documented reason has copy; disabled and absent have none', () => {
    for (const reason of [
      'open-gop-avc',
      'segment-floor',
      'segment-budget',
      'unscannable',
      'ineligible-source',
      'unmappable-codec',
      'poisoned',
    ]) {
      expect(typeof reasonToUserCopy(reason)).toBe('string')
    }
    expect(reasonToUserCopy('disabled')).toBeNull()
    expect(reasonToUserCopy(undefined)).toBeNull()
  })

  test('an unknown reason still says "not available" without leaking the token', () => {
    const copy = reasonToUserCopy('some-future-verdict')
    expect(copy).toBe("Original streaming isn't available for this title.")
    expect(copy).not.toContain('some-future-verdict')
  })

  test('unmappable-codec reads as ineligible, not as an unknown verdict', () => {
    expect(reasonToUserCopy('unmappable-codec')).toBe(reasonToUserCopy('ineligible-source'))
  })

  test('badgeLabel only when offered, reasonCopy only when withheld', () => {
    const offered = enrichDirectInfo(OFFERED)
    expect(offered.badgeLabel).toBe('Original (Dolby Vision)')
    expect(offered.reasonCopy).toBeUndefined()

    const withheld = enrichDirectInfo(WITHHELD)
    expect(withheld.reasonCopy).toContain("can't seek reliably")
    expect(withheld.badgeLabel).toBeUndefined()
  })

  test('the upstream verdict passes through verbatim, unknown fields included', () => {
    const raw = { ...OFFERED, someFutureField: 42 }
    const enriched = enrichDirectInfo(raw)
    expect(enriched.hls).toEqual(OFFERED.hls)
    expect(enriched.file).toEqual(OFFERED.file)
    expect(enriched.someFutureField).toBe(42)
  })

  test('a disabled server produces no copy — the option is hidden, not explained', () => {
    const enriched = enrichDirectInfo({
      hls: { offered: false, reason: 'disabled' },
      file: { available: false },
    })
    expect(enriched.reasonCopy).toBeUndefined()
    expect(enriched.badgeLabel).toBeUndefined()
  })
})

describe('fetchDirectInfo', () => {
  test('a resolved verdict is enriched and then served from cache', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse(OFFERED))

    const first = await fetchDirectInfo({ origin: ORIGIN, key: KEY, fetchImpl })
    expect(first.status).toBe('ok')
    expect(first.value.badgeLabel).toBe('Original (Dolby Vision)')

    const second = await fetchDirectInfo({ origin: ORIGIN, key: KEY, fetchImpl })
    expect(second).toMatchObject({ status: 'ok', cached: true })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  test('the upstream URL is the key\'s direct.json, uncached', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse(WITHHELD))
    await fetchDirectInfo({ origin: ORIGIN, key: KEY, fetchImpl })

    expect(fetchImpl).toHaveBeenCalledWith(
      `${ORIGIN}/stream/${KEY}/direct.json`,
      expect.objectContaining({ cache: 'no-store' })
    )
  })

  test('a slow derivation reports pending, and the work survives the impatient caller', async () => {
    let resolveUpstream
    const fetchImpl = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveUpstream = resolve
        })
    )

    // This caller gives up quickly. Aborting the fetch here would throw away
    // the transcoder's keyframe scan — which is not resumable — so it must not.
    const impatient = await fetchDirectInfo({ origin: ORIGIN, key: KEY, waitMs: 10, fetchImpl })
    expect(impatient).toEqual({ status: 'pending' })

    // The next poll joins the SAME scan rather than starting a second one.
    const patient = fetchDirectInfo({ origin: ORIGIN, key: KEY, waitMs: 5000, fetchImpl })
    resolveUpstream(okResponse(OFFERED))

    expect((await patient).status).toBe('ok')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  test('concurrent callers share one upstream request', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse(OFFERED))

    const results = await Promise.all([
      fetchDirectInfo({ origin: ORIGIN, key: KEY, fetchImpl }),
      fetchDirectInfo({ origin: ORIGIN, key: KEY, fetchImpl }),
      fetchDirectInfo({ origin: ORIGIN, key: KEY, fetchImpl }),
    ])

    expect(results.every((r) => r.status === 'ok')).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  test('distinct titles do not share a verdict', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(okResponse(OFFERED))
      .mockResolvedValueOnce(okResponse(WITHHELD))

    const a = await fetchDirectInfo({ origin: ORIGIN, key: KEY, fetchImpl })
    const b = await fetchDirectInfo({ origin: ORIGIN, key: 'b3RoZXIvWC5ta3Y', fetchImpl })

    expect(a.value.hls.offered).toBe(true)
    expect(b.value.hls.offered).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  test('an unknown key is not-found, not an error', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 404 })
    expect(await fetchDirectInfo({ origin: ORIGIN, key: KEY, fetchImpl })).toEqual({
      status: 'not-found',
    })
  })

  test('upstream failures are reported, never cached as a verdict', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce(okResponse(OFFERED))

    const failed = await fetchDirectInfo({ origin: ORIGIN, key: KEY, fetchImpl })
    expect(failed).toMatchObject({ status: 'upstream-error', upstreamStatus: 503 })

    const retried = await fetchDirectInfo({ origin: ORIGIN, key: KEY, fetchImpl })
    expect(retried.status).toBe('ok')
  })

  test('a network error is an upstream error, not a crash', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const result = await fetchDirectInfo({ origin: ORIGIN, key: KEY, fetchImpl })
    expect(result.status).toBe('upstream-error')
  })

  test('a malformed body is an upstream error, so no bogus verdict is served', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse({ nope: true }))
    const result = await fetchDirectInfo({ origin: ORIGIN, key: KEY, fetchImpl })
    expect(result).toMatchObject({ status: 'upstream-error', reason: 'malformed' })
  })
})
