/**
 * What the casting overlay says the TV is playing.
 *
 * The receiver adapts on its own, so the label must describe ITS rung: the
 * receiver matches the player's bitrate to the master's variants (that is the
 * only source of the rung's dynamic range), and the sender turns that into
 * "1080p · HDR · 7.8 Mbps", or nothing at all until the receiver has said.
 */

import {
  matchVariant,
  parseMasterVariants,
  startNowPlayingReporter,
} from '../../public/receiver/js/now-playing.js'
import { castNowPlayingLabel, sizeFromDimensions } from '@components/MediaPlayer/settingsModel'

// The shape of the transcoder's master for Blade Runner 2049, trimmed.
const MASTER = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud-aac",NAME="English",LANGUAGE="en",DEFAULT=YES,URI="/a/en/index.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=8944400,AVERAGE-BANDWIDTH=8128000,RESOLUTION=1920x1080,FRAME-RATE=23.976,VIDEO-RANGE=SDR,CODECS="avc1.640028,mp4a.40.2",AUDIO="aud-aac"
/v/1/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=7844400,AVERAGE-BANDWIDTH=6183000,RESOLUTION=1920x1080,FRAME-RATE=23.976,VIDEO-RANGE=PQ,CODECS="hvc1.2.4.L123.90,mp4a.40.2",AUDIO="aud-aac"
/v/6/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=22144400,AVERAGE-BANDWIDTH=19128000,RESOLUTION=3840x2160,FRAME-RATE=23.976,VIDEO-RANGE=PQ,CODECS="hvc1.2.4.L153.90,mp4a.40.2",AUDIO="aud-aac"
/v/5/index.m3u8
`

describe('receiver: identifying the rung', () => {
  const variants = parseMasterVariants(MASTER)

  it('reads each variant, BANDWIDTH not confused with AVERAGE-BANDWIDTH', () => {
    expect(variants).toEqual([
      { bandwidth: 8944400, width: 1920, height: 1080, videoRange: 'SDR' },
      { bandwidth: 7844400, width: 1920, height: 1080, videoRange: 'PQ' },
      { bandwidth: 22144400, width: 3840, height: 2160, videoRange: 'PQ' },
    ])
  })

  it('matches the reported bitrate exactly, or to the nearest variant', () => {
    expect(matchVariant(variants, 7844400).videoRange).toBe('PQ')
    expect(matchVariant(variants, 9000000).bandwidth).toBe(8944400)
    expect(matchVariant(variants, 0)).toBeNull()
    expect(matchVariant([], 7844400)).toBeNull()
  })
})

describe('receiver: starting the reporter', () => {
  // CAF's shape: event names live under events.EventType, not on events.
  // receiver.js starts the reporter right before context.start(), so a bad
  // name there once left the TV showing the receiver but never loading.
  const EventType = {
    PLAYER_LOADING: 'PLAYER_LOADING',
    PLAYER_LOAD_COMPLETE: 'PLAYER_LOAD_COMPLETE',
    BITRATE_CHANGED: 'BITRATE_CHANGED',
    PLAYING: 'PLAYING',
  }

  beforeEach(() => {
    global.cast = {
      framework: {
        events: { EventType },
        messages: { MessageType: { MEDIA_STATUS: 'MEDIA_STATUS' } },
      },
    }
  })
  afterEach(() => {
    delete global.cast
  })

  it('listens on real CAF event types and intercepts MEDIA_STATUS', () => {
    const listened = []
    const intercepted = []
    const playerManager = {
      addEventListener: (type) => {
        if (!Object.values(EventType).includes(type)) throw new Error(`unknown event ${type}`)
        listened.push(type)
      },
      setMessageInterceptor: (type) => intercepted.push(type),
    }
    startNowPlayingReporter({
      playerManager,
      castDebugLogger: { debug() {}, warn() {} },
      logTag: 't',
    })
    expect(listened.sort()).toEqual(Object.values(EventType).sort())
    expect(intercepted).toEqual(['MEDIA_STATUS'])
  })
})

describe('sender: the overlay label', () => {
  it('names the rung like the quality menu does', () => {
    expect(castNowPlayingLabel({ width: 1920, height: 1080, hdr: true, bandwidth: 7844400 })).toBe(
      '1080p · HDR · 7.8 Mbps'
    )
    expect(castNowPlayingLabel({ width: 3840, height: 2160, hdr: false, bandwidth: null })).toBe(
      '4K'
    )
  })

  it('says nothing until the receiver reports a size', () => {
    expect(castNowPlayingLabel(null)).toBeNull()
    expect(castNowPlayingLabel({ width: 0, height: 0 })).toBeNull()
  })

  it('sizes a scope film by its width, as the player does', () => {
    expect(sizeFromDimensions(1920, 800)).toBe(1080)
    expect(sizeFromDimensions(1440, 1080)).toBe(1080) // 4:3
    expect(sizeFromDimensions(0, 720)).toBe(720)
    expect(sizeFromDimensions(0, 0)).toBe(0)
  })
})
