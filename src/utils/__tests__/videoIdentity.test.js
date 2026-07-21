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
    expect(canonicalizeStreamPathname(`/stream/${B64}/v/720p/index.m3u8`)).toBe(
      `/stream/${B64}/v/720p/index.m3u8`
    )
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
