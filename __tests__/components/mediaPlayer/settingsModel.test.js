/**
 * What the settings panel's rows say, and in what order.
 *
 * Worth protecting: rungs read best-first with HDR ahead of SDR at the same
 * size; the hi-fi rung (no manifest marker) is the only one called "High
 * bitrate"; nothing names a source HDR format; and speed never offers more
 * than the transcoder can keep up with.
 */

import {
  PLAYBACK_RATES,
  activeQualityName,
  captionRow,
  formatMbps,
  languageName,
  qualityName,
  qualityRows,
  rateLabel,
  sortCaptionOptions,
} from '@components/MediaPlayer/settingsModel'
import {
  audioDefaultsFromTracks,
  audioTrackKey,
  traitsFromLevels,
} from '@components/MediaPlayer/renditionTraits'

const level = (width, height, videoCodec, bitrate, attrs = {}) => ({
  width,
  height,
  videoCodec,
  bitrate,
  attrs,
})

// Blade Runner 2049 as hls.js holds it in Chrome, in hls.js order (SDR rungs,
// then PQ), with the store's ids and the player's own size labels.
const levels = [
  level(256, 144, 'avc1.64001E', 182800, { 'VIDEO-RANGE': 'SDR' }),
  level(854, 480, 'avc1.64001F', 1794400, { 'VIDEO-RANGE': 'SDR' }),
  level(1280, 720, 'avc1.640028', 4544400, { 'VIDEO-RANGE': 'SDR' }),
  level(1920, 1080, 'avc1.640028', 8944400, { 'VIDEO-RANGE': 'SDR' }),
  level(1920, 1080, 'avc1.640029', 22144400, { 'VIDEO-RANGE': 'SDR' }),
  level(1920, 1080, 'hvc1.2.4.L123.90', 7844400, { 'VIDEO-RANGE': 'PQ' }),
  level(3840, 2160, 'hvc1.2.4.L153.90', 22144400, { 'VIDEO-RANGE': 'PQ' }),
]
const renditions = levels.map((l, i) => ({
  id: String(i),
  width: l.width,
  height: l.height,
  codec: l.videoCodec,
  bitrate: l.bitrate,
}))
const options = [
  { value: 'auto', label: 'Auto' },
  ...renditions.map((r) => ({ value: r.id, label: `${r.height}p` })),
]
const traits = traitsFromLevels(levels)

describe('qualityRows', () => {
  test('best first, HDR before SDR at the same size, the hi-fi rung named', () => {
    expect(
      qualityRows(options, renditions, traits).map((r) => [r.title, r.range, r.detail])
    ).toEqual([
      ['4K', 'HDR', '22.1 Mbps'],
      ['1080p', 'HDR', '7.8 Mbps'],
      ['1080p', null, 'High bitrate · 22.1 Mbps'],
      ['1080p', null, '8.9 Mbps'],
      ['720p', null, '4.5 Mbps'],
      ['480p', null, '1.8 Mbps'],
      ['144p', null, '0.2 Mbps'],
    ])
  })

  test('a lone rung at its size and range is never "High bitrate"', () => {
    const one = qualityRows(options.slice(0, 5), renditions, traits)
    expect(one.some((r) => r.detail.includes('High bitrate'))).toBe(false)
  })

  test('Original is the source, not a copy: labelled Original, never High bitrate', () => {
    const withOriginal = [
      ...levels,
      level(1920, 1080, 'avc1.640032', 40e6, {
        'VIDEO-RANGE': 'SDR',
        'STABLE-VARIANT-ID': 'original',
      }),
    ]
    const r = withOriginal.map((l, i) => ({
      id: String(i),
      width: l.width,
      height: l.height,
      codec: l.videoCodec,
      bitrate: l.bitrate,
    }))
    const o = [
      { value: 'auto', label: 'Auto' },
      ...r.map((x) => ({ value: x.id, label: `${x.height}p` })),
    ]
    const rows = qualityRows(o, r, traitsFromLevels(withOriginal))
    expect(rows.find((x) => x.value === '7').detail).toBe('Original · 40 Mbps')
    expect(rows.filter((x) => x.detail.includes('High bitrate')).map((x) => x.value)).toEqual(['4'])
  })

  test('without engine traits (native HLS) rows still read, untagged', () => {
    const rows = qualityRows(options, renditions, new Map())
    expect(rows[0]).toMatchObject({ title: '4K', range: null })
  })
})

test('qualityName: 4K and 8K for UHD, the player size otherwise', () => {
  expect(qualityName('2160p')).toBe('4K')
  expect(qualityName('4320p')).toBe('8K')
  expect(qualityName('1080p')).toBe('1080p')
  expect(qualityName('Quality')).toBe('Quality')
})

test('activeQualityName names the playing rung with its range', () => {
  expect(activeQualityName(options, renditions[5], traits)).toBe('1080p HDR')
  expect(activeQualityName(options, renditions[4], traits)).toBe('1080p')
  expect(activeQualityName(options, null, traits)).toBe('')
})

test('formatMbps', () => {
  expect(formatMbps(22144400)).toBe('22.1 Mbps')
  expect(formatMbps(40e6)).toBe('40 Mbps')
  expect(formatMbps(0)).toBeNull()
})

test('speed is capped at 1.5× and 1× reads Normal', () => {
  expect(Math.max(...PLAYBACK_RATES)).toBe(1.5)
  expect(PLAYBACK_RATES).toContain(1)
  expect(rateLabel(1)).toBe('Normal')
  expect(rateLabel(1.25)).toBe('1.25×')
})

describe('captions', () => {
  test('auto-generated tracks lose the suffix and are marked; progress shows', () => {
    expect(captionRow('English - Auto Generated')).toEqual({
      title: 'English',
      auto: true,
      detail: null,
      generating: false,
      failed: false,
    })
    expect(
      captionRow('English - Auto Generated', { status: 'running', progressPct: 0.42 })
    ).toEqual({
      title: 'English',
      auto: true,
      detail: 'Generating… 42%',
      generating: true,
      failed: false,
    })
    expect(captionRow('English Hearing Impaired')).toEqual({
      title: 'English Hearing Impaired',
      auto: false,
      detail: null,
      generating: false,
      failed: false,
    })
  })

  test('a generation that could not start says why, instead of an empty track', () => {
    expect(captionRow('English - Auto Generated', { status: 'failed', httpStatus: 401 })).toEqual({
      title: 'English',
      auto: true,
      detail: "Couldn't generate: not authorized",
      generating: false,
      failed: true,
    })
    expect(
      captionRow('English - Auto Generated', { status: 'failed', httpStatus: 429 }).detail
    ).toBe("Couldn't generate: too many requests, try again later")
    expect(
      captionRow('English - Auto Generated', { status: 'failed', httpStatus: null }).detail
    ).toBe("Couldn't generate: try again later")
  })

  test('Off, then auto-generated, then human tracks', () => {
    const sorted = sortCaptionOptions([
      { value: 'a', label: 'English' },
      { value: 'b', label: 'English - Auto Generated' },
      { value: 'off', label: 'Off' },
      { value: 'c', label: 'Spanish' },
    ])
    expect(sorted.map((o) => o.value)).toEqual(['off', 'b', 'a', 'c'])
  })
})

describe('audio', () => {
  test('the English name only when it adds something', () => {
    expect(languageName('it', 'Italiano')).toBe('Italian')
    expect(languageName('en', 'English')).toBeNull()
    expect(languageName(undefined, 'Audio')).toBeNull()
  })

  test('DEFAULT=YES tracks are keyed the way the store names them', () => {
    const defaults = audioDefaultsFromTracks([
      { lang: 'it', name: 'Italiano', default: false },
      { lang: 'en', name: 'English', default: true },
    ])
    expect(defaults.has(audioTrackKey({ language: 'en', label: 'English' }))).toBe(true)
    expect(defaults.has(audioTrackKey({ language: 'it', label: 'Italiano' }))).toBe(false)
  })
})
