/**
 * Quality-menu traits read off hls.js levels.
 *
 * Worth protecting: a rung is tagged HDR only when its master line says PQ (a
 * wrong tag sends a viewer to a washed-out picture on an SDR display), "Original"
 * only for the transcoder's direct-play marker, and each store rendition finds
 * ITS level even when several rungs share a height.
 */

import { renditionKey, traitsFromLevels, traitTags } from '@components/MediaPlayer/renditionTraits'

const level = (width, height, videoCodec, bitrate, attrs = {}) => ({
  width,
  height,
  videoCodec,
  bitrate,
  attrs,
})

// Blade Runner 2049's ladder as hls.js holds it in Chrome (E-AC-3/AC-3 levels dropped).
const ladder = [
  level(256, 144, 'avc1.64001E', 182800, { 'VIDEO-RANGE': 'SDR' }),
  level(1920, 1080, 'avc1.640028', 8944400, { 'VIDEO-RANGE': 'SDR' }),
  level(1920, 1080, 'avc1.640029', 22144400, { 'VIDEO-RANGE': 'SDR' }),
  level(1920, 1080, 'hvc1.2.4.L123.90', 7844400, { 'VIDEO-RANGE': 'PQ' }),
  level(3840, 2160, 'hvc1.2.4.L153.90', 22144400, {
    'VIDEO-RANGE': 'PQ',
    'STABLE-VARIANT-ID': 'original',
    'SUPPLEMENTAL-CODECS': 'dvh1.08.06/db1p',
  }),
]

// The store's rendition: the same four fields the video.js adapter copies.
const rendition = (l, id) => ({
  id,
  width: l.width,
  height: l.height,
  codec: l.videoCodec,
  bitrate: l.bitrate,
})

describe('renditionTraits', () => {
  const traits = traitsFromLevels(ladder)

  test('tags each same-height rung by its own level', () => {
    expect(traitTags(traits, rendition(ladder[1], '1'))).toEqual([])
    expect(traitTags(traits, rendition(ladder[2], '2'))).toEqual([])
    expect(traitTags(traits, rendition(ladder[3], '3'))).toEqual(['HDR'])
  })

  test('the direct-play rung is Original and HDR, never Dolby Vision', () => {
    expect(traitTags(traits, rendition(ladder[4], '4'))).toEqual(['Original', 'HDR'])
  })

  test('HLG is named, and a missing VIDEO-RANGE means SDR', () => {
    const t = traitsFromLevels([
      level(1920, 1080, 'hvc1.2.4.L120.90', 6e6, { 'VIDEO-RANGE': 'HLG' }),
      level(1280, 720, 'avc1.64001F', 4e6),
    ])
    expect(
      traitTags(t, { width: 1920, height: 1080, codec: 'hvc1.2.4.L120.90', bitrate: 6e6 })
    ).toEqual(['HLG'])
    expect(traitTags(t, { width: 1280, height: 720, codec: 'avc1.64001F', bitrate: 4e6 })).toEqual(
      []
    )
  })

  test('no engine, no level, or no rendition means no tags', () => {
    expect(traitTags(traitsFromLevels(undefined), rendition(ladder[3], '3'))).toEqual([])
    expect(
      traitTags(traits, { width: 640, height: 360, codec: 'avc1.64001E', bitrate: 1 })
    ).toEqual([])
    expect(traitTags(traits, undefined)).toEqual([])
  })

  test('the key ignores the store id, which is a parse index hls.js can outlive', () => {
    expect(renditionKey(rendition(ladder[3], '3'))).toBe(renditionKey(rendition(ladder[3], '7')))
  })
})
