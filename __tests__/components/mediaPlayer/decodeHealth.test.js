/**
 * The decode-health verdict, and the storage that decides its wording.
 *
 * The two things worth protecting here are (1) the notice can only appear when
 * the ladder provably lost height, because a wrong "restart your browser" is
 * worse than silence, and (2) the capability baseline never forgets that HEVC
 * once worked — losing that is what makes the second playback of a
 * GPU-crashed session tell the viewer their browser can't play HEVC at all.
 */

import {
  decodeHealthVerdict,
  hadHevcBefore,
  probeHevc,
  readHevcBaseline,
  recordHevcBaseline,
  summarizeAdvertised,
} from '@components/MediaPlayer/decodeHealth'

// A 4K SDR ladder: HEVC only at 2160, AVC from 1080 down.
const UHD_SDR = [
  { height: 2160, codec: 'hvc1.1.6.L153.90' },
  { height: 1080, codec: 'avc1.640028' },
  { height: 720, codec: 'avc1.64001f' },
  { height: 480, codec: 'avc1.64001e' },
  { height: 144, codec: 'avc1.64000c' },
]

const base = {
  offeredMax: 2160,
  rungs: UHD_SDR,
  keptMax: 1080,
  keptTopCodec: 'avc1.640028',
  hevcNow: false,
  hadHevc: false,
  webgl: null,
  chromium: false,
}

describe('decodeHealthVerdict', () => {
  describe('says nothing unless height was actually lost', () => {
    it('is silent when every advertised rung survived', () => {
      expect(decodeHealthVerdict({ ...base, keptMax: 2160, keptTopCodec: 'hvc1.1.6.L153.90' })).toBeNull()
    })

    it('is silent when the server never offered anything taller', () => {
      // A GPU-less transcoder clamps max height to 1080 for EVERY client, and
      // an HDR source drops the SDR 2160 rung outright. Gating on the title's
      // own dimensions would blame the browser for both.
      const ladder = UHD_SDR.filter((r) => r.height <= 1080)
      expect(decodeHealthVerdict({ ...base, offeredMax: 1080, rungs: ladder })).toBeNull()
    })

    it('is silent before the manifest has been read', () => {
      expect(decodeHealthVerdict({ ...base, offeredMax: 0, rungs: [] })).toBeNull()
      expect(decodeHealthVerdict({ ...base, keptMax: 0 })).toBeNull()
    })

    it('is silent when an HEVC rung is dropped but no height is lost', () => {
      // A 1080p HEVC source served through JIT gets an hvc1 copy rung beside
      // the ladder's 1080p AVC rung; losing it costs nothing worth mentioning.
      const rungs = [
        { height: 1080, codec: 'hvc1.1.6.L120.90' },
        { height: 1080, codec: 'avc1.640028' },
        { height: 720, codec: 'avc1.64001f' },
      ]
      expect(decodeHealthVerdict({ ...base, offeredMax: 1080, rungs, keptMax: 1080 })).toBeNull()
    })
  })

  describe('picks the tier that earns restart advice', () => {
    it('is gpu-regressed when this browser opened HEVC before and cannot now', () => {
      const verdict = decodeHealthVerdict({ ...base, hadHevc: true, hevcNow: false })
      expect(verdict).toMatchObject({ tier: 'gpu-regressed', offeredMax: 2160, keptMax: 1080 })
    })

    it('is gpu-regressed on Chromium with no HEVC and a dead GPU, without any baseline', () => {
      const verdict = decodeHealthVerdict({ ...base, chromium: true, webgl: 'dead' })
      expect(verdict.tier).toBe('gpu-regressed')
    })

    it('is no-hevc for a legitimately different setup', () => {
      expect(decodeHealthVerdict(base).tier).toBe('no-hevc')
    })

    it('does not hand a non-Chromium browser the Chromium-only advice', () => {
      // Firefox under resistFingerprinting can report a dead-looking context.
      const verdict = decodeHealthVerdict({ ...base, chromium: false, webgl: 'dead' })
      expect(verdict.tier).toBe('no-hevc')
    })

    it('does not claim regression from a live GPU alone', () => {
      const verdict = decodeHealthVerdict({ ...base, chromium: true, webgl: 'alive' })
      expect(verdict.tier).toBe('no-hevc')
    })

    it('is no-hevc when the probe disagrees with the ladder', () => {
      // Windows Firefox: isTypeSupported answers true, but hls.js removes every
      // HEVC level anyway through its own user-agent override. Rungs are gone,
      // so we still speak — and restarting genuinely would not help.
      const verdict = decodeHealthVerdict({ ...base, hevcNow: true, hadHevc: true })
      expect(verdict.tier).toBe('no-hevc')
    })
  })

  describe('makes no claim it cannot prove', () => {
    it('falls back to limited when the lost rungs are not all HEVC', () => {
      const rungs = [
        { height: 2160, codec: 'av01.0.13M.10' },
        { height: 1440, codec: 'hvc1.1.6.L150.90' },
        { height: 1080, codec: 'avc1.640028' },
      ]
      const verdict = decodeHealthVerdict({ ...base, rungs, hadHevc: true })
      expect(verdict.tier).toBe('limited')
    })

    it('only calls the surviving rung AVC when it actually is', () => {
      expect(decodeHealthVerdict(base).keptIsAvc).toBe(true)
      expect(
        decodeHealthVerdict({ ...base, keptTopCodec: 'vp09.00.10.08' }).keptIsAvc
      ).toBe(false)
    })

    it('reports the measured ceiling, not the ladder we expect', () => {
      // The 1080p AVC floor is only guaranteed post-epoch-17, and the
      // throughput budget can still shed it — the confirmed case landed at 720.
      const verdict = decodeHealthVerdict({ ...base, keptMax: 720, keptTopCodec: 'avc1.64001f' })
      expect(verdict.keptMax).toBe(720)
      expect(verdict.offeredMax).toBe(2160)
    })
  })
})

describe('summarizeAdvertised', () => {
  it('takes the tallest advertised rung and keeps every codec', () => {
    const snapshot = summarizeAdvertised(
      [
        { height: 2160, videoCodec: 'hvc1.1.6.L153.90' },
        { height: 1080, videoCodec: 'avc1.640028' },
      ],
      'https://x/master.m3u8'
    )
    expect(snapshot).toMatchObject({ src: 'https://x/master.m3u8', offeredMax: 2160 })
    expect(snapshot.rungs).toHaveLength(2)
  })

  it('survives a master with no usable heights rather than reporting a false ceiling', () => {
    expect(summarizeAdvertised([], 'x')).toBeNull()
    expect(summarizeAdvertised(null, 'x')).toBeNull()
    expect(summarizeAdvertised([{ videoCodec: 'avc1.640028' }], 'x')).toBeNull()
  })
})

describe('the HEVC capability baseline', () => {
  beforeEach(() => {
    globalThis.localStorage.clear()
  })

  it('remembers that HEVC once worked, forever', () => {
    recordHevcBaseline(true)
    recordHevcBaseline(false)
    // The whole point: a degraded session must not erase its own history.
    expect(hadHevcBefore(readHevcBaseline())).toBe(true)
    expect(readHevcBaseline().hevc).toBe(false)
  })

  it('never invents a history it does not have', () => {
    recordHevcBaseline(false)
    recordHevcBaseline(false)
    expect(hadHevcBefore(readHevcBaseline())).toBe(false)
  })

  it('ignores an unknown probe result instead of storing one', () => {
    recordHevcBaseline(null)
    expect(readHevcBaseline()).toBeNull()
  })

  it('keeps the first sighting across writes', () => {
    recordHevcBaseline(true)
    const first = readHevcBaseline().firstSeenAt
    recordHevcBaseline(false)
    expect(readHevcBaseline().firstSeenAt).toBe(first)
  })

  it('treats garbage in storage as no baseline', () => {
    globalThis.localStorage.setItem('mediaPlayer:hevcBaseline', 'not json')
    expect(readHevcBaseline()).toBeNull()
    expect(hadHevcBefore(readHevcBaseline())).toBe(false)
  })
})

describe('probeHevc', () => {
  afterEach(() => {
    delete globalThis.MediaSource
    delete globalThis.ManagedMediaSource
  })

  it('is unknown, not false, when MediaSource does not exist', () => {
    // jsdom has no MediaSource, and neither does a native-HLS path. Reporting
    // false there would blame a perfectly healthy client.
    expect(probeHevc()).toBeNull()
  })

  it('asks with hls.js’s own MIME spelling, so the answer matches the filter', () => {
    const asked = []
    globalThis.MediaSource = {
      isTypeSupported: (type) => {
        asked.push(type)
        return false
      },
    }
    expect(probeHevc()).toBe(false)
    // No space after the semicolon and no quotes — mimeTypeForCodec is
    // `type + "/mp4;codecs=" + codec`.
    expect(asked[0]).toMatch(/^video\/mp4;codecs=hvc1\./)
  })

  it('accepts any of its probe strings, so one picky parser cannot veto', () => {
    let call = 0
    globalThis.MediaSource = { isTypeSupported: () => ++call === 3 }
    expect(probeHevc()).toBe(true)
  })

  it('prefers ManagedMediaSource where it exists, as hls.js does', () => {
    globalThis.ManagedMediaSource = { isTypeSupported: () => true }
    globalThis.MediaSource = { isTypeSupported: () => false }
    expect(probeHevc()).toBe(true)
  })

  it('is unknown when the probe itself throws', () => {
    globalThis.MediaSource = {
      isTypeSupported: () => {
        throw new Error('nope')
      },
    }
    expect(probeHevc()).toBeNull()
  })
})
