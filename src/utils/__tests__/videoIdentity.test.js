/**
 * Tests for the shared video-identity implementation.
 *
 * Fixture values are PRODUCTION-VERIFIED: the expected hashes were
 * reproduced against live FlatMovies/WatchHistory documents (2026-07-19,
 * Backrooms/Lou). If a change breaks these pins it breaks every stored
 * normalizedVideoId in the database — do not update the expected values
 * without a full re-keying migration.
 */
import { generateNormalizedVideoId, canonicalizeStreamPathname } from '@src/utils/videoIdentity'

const REL = 'movies/Backrooms/Backrooms.2026.2160p.iT.WEB-DL.DV.HDR10+-Ben.The.Men.mp4'
const REL_HASH = 'c99b3efd02ee33fd'
const B64 = Buffer.from(REL).toString('base64').replace(/=+$/, '')
const B64_URLSAFE = B64.replace(/\+/g, '-').replace(/\//g, '_')

describe('generateNormalizedVideoId', () => {
  test('pins the production hash for a direct file-server URL (no churn)', () => {
    expect(generateNormalizedVideoId(`https://personalserver.adamdrumm.com/${REL}`)).toBe(REL_HASH)
    expect(
      generateNormalizedVideoId(
        'https://personalserver.adamdrumm.com/movies/Lou/Lou.2017.1080p.BluRay.REMUX.AVC.DTS-HD.MA.7.1-EPSiLON-xpost.mp4'
      )
    ).toBe('308928ae59a39e40')
  })

  test('is host-invariant for internal file servers', () => {
    expect(generateNormalizedVideoId(`http://other-server:8080/${REL}`)).toBe(REL_HASH)
  })

  test('JIT master.m3u8 URL canonicalizes to the source identity', () => {
    expect(
      generateNormalizedVideoId(`https://transcoder.adamdrumm.com/stream/${B64}/master.m3u8`)
    ).toBe(REL_HASH)
  })

  test('pins the production rung-URL rows to the direct-play hash (identity fork fix)', () => {
    // Exact videoIds from the July 2026 orphaned WatchHistory rows — variant
    // rungs of the 2160p Backrooms file (= REL). Before the rung fix these
    // hashed as opaque pathnames (393f6c8b…/305cd958…), forking identity.
    const v2 =
      'https://transcoder.adamdrumm.com/stream/bW92aWVzL0JhY2tyb29tcy9CYWNrcm9vbXMuMjAyNi4yMTYwcC5pVC5XRUItREwuRFYuSERSMTArLUJlbi5UaGUuTWVuLm1wNA/v/2/index.m3u8'
    const v1 =
      'https://transcoder.adamdrumm.com/stream/bW92aWVzL0JhY2tyb29tcy9CYWNrcm9vbXMuMjAyNi4yMTYwcC5pVC5XRUItREwuRFYuSERSMTArLUJlbi5UaGUuTWVuLm1wNA/v/1/index.m3u8'
    expect(generateNormalizedVideoId(v2)).toBe(REL_HASH)
    expect(generateNormalizedVideoId(v1)).toBe(REL_HASH)
  })

  test('pins the production JIT WatchHistory row hash equivalence', () => {
    // Exact videoId stored in a production WatchHistory row; its canonical
    // identity must equal the direct-play 1080p hash.
    const jitVideoId =
      'https://transcoder.adamdrumm.com/stream/bW92aWVzL0JhY2tyb29tcy9CYWNrcm9vbXMuMjAyNi4xMDgwcC5BTVpOLldFQi1ETC5ERFA1LjEuQXRtb3MuSC4yNjQtQllORFIubXA0/master.m3u8'
    expect(generateNormalizedVideoId(jitVideoId)).toBe('19ce3a0b316c7251')
    expect(
      generateNormalizedVideoId(
        'https://personalserver.adamdrumm.com/movies/Backrooms/Backrooms.2026.1080p.AMZN.WEB-DL.DDP5.1.Atmos.H.264-BYNDR.mp4'
      )
    ).toBe('19ce3a0b316c7251')
  })

  test('url-safe base64 alphabet and padding variants canonicalize identically', () => {
    expect(
      generateNormalizedVideoId(`https://transcoder.adamdrumm.com/stream/${B64_URLSAFE}/master.m3u8`)
    ).toBe(REL_HASH)
    const padded = Buffer.from(REL).toString('base64') // may include '='
    expect(
      generateNormalizedVideoId(`https://transcoder.adamdrumm.com/stream/${padded}/master.m3u8`)
    ).toBe(REL_HASH)
  })

  test('DASH manifest.mpd canonicalizes identically to HLS', () => {
    expect(
      generateNormalizedVideoId(`https://transcoder.adamdrumm.com/stream/${B64}/manifest.mpd`)
    ).toBe(REL_HASH)
  })

  test('canonicalization happens before lowercasing (base64 is case-sensitive)', () => {
    // Lowercasing the segment first would decode to garbage; the canonical
    // hash must equal the hash of the decoded source path, not of the
    // lowercased base64 pathname.
    const jit = `https://h/stream/${B64}/master.m3u8`
    expect(generateNormalizedVideoId(jit)).toBe(generateNormalizedVideoId(`https://h/${REL}`))
    const crypto = require('crypto')
    const naive = crypto
      .createHash('sha256')
      .update(`/stream/${B64}/master.m3u8`.toLowerCase())
      .digest('hex')
      .substring(0, 16)
    expect(generateNormalizedVideoId(jit)).not.toBe(naive)
  })

  test('YouTube URLs keep the full href (query string distinguishes videos)', () => {
    const a = generateNormalizedVideoId('https://www.youtube.com/watch?v=ABC123')
    const b = generateNormalizedVideoId('https://www.youtube.com/watch?v=XYZ789')
    expect(a).not.toBe(b)
  })

  test('percent-encoded paths hash stably (decode-loop regression)', () => {
    const encoded = generateNormalizedVideoId(
      'https://personalserver.adamdrumm.com/movies/Partly%20Cloudy/Partly.Cloudy.2009.BluRay.1080p.DD5.1-EX.AVC.REMUX-FraMeSToR.mp4'
    )
    expect(encoded).toBe('eb1a24a1c68b9990') // production-verified
  })

  test('empty/null input returns empty string', () => {
    expect(generateNormalizedVideoId('')).toBe('')
    expect(generateNormalizedVideoId(null)).toBe('')
    expect(generateNormalizedVideoId(undefined)).toBe('')
  })
})

describe('canonicalizeStreamPathname', () => {
  test('decodes a valid JIT pathname to the source pathname', () => {
    expect(canonicalizeStreamPathname(`/stream/${B64}/master.m3u8`)).toBe(`/${REL}`)
    expect(canonicalizeStreamPathname(`/stream/${B64_URLSAFE}/manifest.mpd`)).toBe(`/${REL}`)
  })

  test('leaves non-matching pathnames unchanged', () => {
    expect(canonicalizeStreamPathname(`/${REL}`)).toBe(`/${REL}`)
    expect(canonicalizeStreamPathname('/stream/')).toBe('/stream/')
    expect(canonicalizeStreamPathname(`/stream/${B64}`)).toBe(`/stream/${B64}`)
  })

  test('variant rungs, audio rungs, and segments canonicalize like the master', () => {
    // Production falsified the "rungs are never reported" assumption (July
    // 2026: players echoed /v/N/index.m3u8 as videoId for Backrooms). Every
    // path under /stream/<b64>/ names the same source file.
    for (const tail of ['v/2/index.m3u8', 'v/720p/index.m3u8', 'a/0/index.m3u8', 'v/0/seg-00042.m4s']) {
      expect(canonicalizeStreamPathname(`/stream/${B64}/${tail}`)).toBe(`/${REL}`)
    }
  })

  test('rejects non-base64 stream segments via round-trip guard', () => {
    // Plausible-looking but not the base64 of anything path-shaped.
    const p = '/stream/live123/master.m3u8'
    expect(canonicalizeStreamPathname(p)).toBe(p)
  })

  test('rejects decoded payloads containing control characters', () => {
    const p = `/stream/${Buffer.from('movies/x\u0007y.mp4').toString('base64')}/master.m3u8`
    expect(canonicalizeStreamPathname(p)).toBe(p)
  })

  test('rejects decoded payloads without a path separator', () => {
    const p = `/stream/${Buffer.from('moviesfile.mp4').toString('base64')}/master.m3u8`
    expect(canonicalizeStreamPathname(p)).toBe(p)
  })

  test('rejects absolute (leading-slash) decoded payloads — contract is source-relative', () => {
    const p = `/stream/${Buffer.from('/movies/x.mp4').toString('base64')}/master.m3u8`
    expect(canonicalizeStreamPathname(p)).toBe(p)
  })

  test('non-string input passes through', () => {
    expect(canonicalizeStreamPathname(null)).toBe(null)
    expect(canonicalizeStreamPathname(undefined)).toBe(undefined)
  })
})

describe('WHATWG serialization parity (spaced/non-ASCII paths)', () => {
  // The backend base64s the RAW path while served URLs are percent-encoded.
  // The canonical form must be re-serialized through the same WHATWG parser
  // the direct-play flow uses, or every spaced title forks identity between
  // JIT and direct playback.

  test('Kingdom of Heaven production pair: jit === direct', () => {
    // b64 captured from the live transcoder; path contains spaces.
    const jit =
      'https://transcoder.adamdrumm.com/stream/bW92aWVzL0tpbmdkb20gb2YgSGVhdmVuL0tpbmdkb20ub2YuSGVhdmVuLjIwMDUuREMuNEsuSERSLkRWLjIxNjBwLkJEUmVtdXguSXRhLkVuZy54MjY1LU5BSE9NLm1rdg/master.m3u8'
    const direct =
      'https://personalserver.adamdrumm.com/movies/Kingdom%20of%20Heaven/Kingdom.of.Heaven.2005.DC.4K.HDR.DV.2160p.BDRemux.Ita.Eng.x265-NAHOM.mkv'
    expect(generateNormalizedVideoId(jit)).toBe(generateNormalizedVideoId(direct))
  })

  test('Partly Cloudy (the executed counter-example): jit === direct === production pin', () => {
    const rel = 'movies/Partly Cloudy/Partly.Cloudy.2009.BluRay.1080p.DD5.1-EX.AVC.REMUX-FraMeSToR.mp4'
    const b64 = Buffer.from(rel).toString('base64').replace(/=+$/, '')
    const jit = `https://t/stream/${b64}/master.m3u8`
    expect(generateNormalizedVideoId(jit)).toBe('eb1a24a1c68b9990')
  })

  test('non-ASCII path: jit === direct', () => {
    const rel = 'movies/Amélie/Amélie.2001.mkv'
    const b64 = Buffer.from(rel).toString('base64').replace(/=+$/, '')
    expect(generateNormalizedVideoId(`https://t/stream/${b64}/master.m3u8`)).toBe(
      generateNormalizedVideoId('https://h/movies/Am%C3%A9lie/Am%C3%A9lie.2001.mkv')
    )
  })

  test('"#" truncation parity: both flows truncate identically', () => {
    // A literal '#' in a filename truncates the WHATWG pathname in BOTH
    // flows (direct play decodes %23 to '#' before re-parsing). The quirk is
    // fine as long as it is byte-identical on both paths.
    const rel = 'movies/Test #1/file.mp4'
    const b64 = Buffer.from(rel).toString('base64').replace(/=+$/, '')
    expect(generateNormalizedVideoId(`https://t/stream/${b64}/master.m3u8`)).toBe(
      generateNormalizedVideoId('https://h/movies/Test%20%231/file.mp4')
    )
  })

  test('spaced canonical pathname is the percent-encoded form', () => {
    const rel = 'movies/Kingdom of Heaven/x.mkv'
    const b64 = Buffer.from(rel).toString('base64').replace(/=+$/, '')
    expect(canonicalizeStreamPathname(`/stream/${b64}/master.m3u8`)).toBe(
      '/movies/Kingdom%20of%20Heaven/x.mkv'
    )
  })
})
