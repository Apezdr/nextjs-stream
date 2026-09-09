import Hls from 'hls.js'
import { HLS_PLAYBACK_CONFIG } from '@components/MediaPlayer/hlsPlaybackConfig'

const engines = []

// Exercise the installed HLS.js ABR controller, not a reimplementation of its
// selection formula. Only the manifest/buffer inputs are fixtures (no network).
function engine(config = {}) {
  const hls = new Hls({ autoStartLoad: false, useMediaCapabilities: false, ...config })
  engines.push(hls)
  const levels = [
    [144, 182_800],
    [480, 1_794_400],
    [720, 4_544_400],
    [1080, 8_944_400],
  ].map(([height, bitrate]) => ({
    height,
    width: Math.round((height * 16) / 9),
    bitrate,
    maxBitrate: bitrate,
    averageBitrate: bitrate,
    codecSet: 'avc1,mp4a',
    videoRange: 'SDR',
    frameRate: 24,
    score: 0,
    loadError: 0,
    fragmentError: 0,
    details: { live: false, averagetargetduration: 6 },
    supportedResult: { decodingInfoResults: [] },
  }))
  Object.defineProperties(hls, {
    levels: { value: levels },
    firstLevel: { value: 0 },
  })
  return hls
}

function playback(hls, { bandwidth, level = 0, buffer = 30, ttfb = 100 }) {
  Object.defineProperties(hls, {
    loadLevel: { value: level, configurable: true },
    loadLevelObj: { value: hls.levels[level], configurable: true },
    media: { value: { playbackRate: 1 }, configurable: true },
    mainForwardBufferInfo: { value: { len: buffer }, configurable: true },
  })
  const abr = hls.abrController
  abr.lastLoadedFragLevel = level
  abr.fragCurrent = { duration: 6 }
  abr.bwEstimator.sample(1000, bandwidth / 8)
  abr.bwEstimator.sampleTTFB(ttfb)
  return hls.nextAutoLevel
}

afterEach(() => {
  for (const hls of engines.splice(0)) hls.destroy()
})

test('starts adaptively at 720p on the observed ladder instead of 144p', () => {
  expect(engine().firstAutoLevel).toBe(0)
  const hls = engine(HLS_PLAYBACK_CONFIG.hlsJs)
  expect(hls.firstAutoLevel).toBe(2)
  expect(hls.startLevel).toBe(-1)
  expect(hls.config.testBandwidth).toBe(false)
  expect(hls.autoLevelEnabled).toBe(true)
})

test('upgrades to 720p with 6 Mbps measured bandwidth, retaining headroom', () => {
  expect(playback(engine(), { bandwidth: 6_000_000 })).toBe(1)
  expect(playback(engine(HLS_PLAYBACK_CONFIG.hlsJs), { bandwidth: 6_000_000 })).toBe(2)
})

test('an empty-buffer seek with origin latency need not drop a sustainable 720p level', () => {
  const input = { bandwidth: 10_000_000, level: 2, buffer: 0, ttfb: 2500 }
  expect(playback(engine(), input)).toBe(1)
  expect(playback(engine(HLS_PLAYBACK_CONFIG.hlsJs), input)).toBe(2)
})

test('still downgrades to the floor when measured bandwidth is genuinely low', () => {
  expect(
    playback(engine(HLS_PLAYBACK_CONFIG.hlsJs), {
      bandwidth: 300_000,
      level: 2,
      buffer: 0,
    })
  ).toBe(0)
})

test('recovers the bandwidth estimate faster after a pessimistic sample', () => {
  const baseline = engine().abrController.bwEstimator
  const tuned = engine(HLS_PLAYBACK_CONFIG.hlsJs).abrController.bwEstimator
  for (const estimator of [baseline, tuned]) {
    estimator.sample(8000, 200_000) // 200 kbps
    for (let i = 0; i < 5; i++) estimator.sample(1000, 1_250_000) // 10 Mbps
  }
  expect(tuned.getEstimate()).toBeGreaterThan(baseline.getEstimate())
})

test('removes the viewport ceiling without forcing manual quality or a minimum bitrate', () => {
  expect(HLS_PLAYBACK_CONFIG.hlsJs.capLevelToPlayerSize).toBe(false)
  expect(HLS_PLAYBACK_CONFIG.hlsJs).not.toHaveProperty('minAutoBitrate')
  expect(HLS_PLAYBACK_CONFIG.hlsJs).not.toHaveProperty('capLevelOnFPSDrop')
  expect(HLS_PLAYBACK_CONFIG.hlsJs).not.toHaveProperty('abrBandWidthFactor')
  expect(Object.isFrozen(HLS_PLAYBACK_CONFIG)).toBe(true)
  expect(Object.isFrozen(HLS_PLAYBACK_CONFIG.hlsJs)).toBe(true)
})
