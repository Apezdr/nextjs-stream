'use strict'

/**
 * Tells senders what the TV is actually playing: the resolution, bitrate and
 * dynamic range of the rung on screen.
 *
 * The receiver picks renditions itself (adaptive), so a sender's quality menu
 * doesn't apply on the TV; the sender's casting overlay shows this instead.
 * Published on every MEDIA_STATUS as the standard videoInfo (width, height,
 * hdrType), which senders read as RemotePlayer.videoInfo, plus
 * customData.nowPlaying { width, height, bandwidth, videoRange } for what
 * videoInfo has no field for.
 *
 * The rung is identified by matching the player's reported bitrate against
 * the master playlist's BANDWIDTH values. That is also where VIDEO-RANGE comes
 * from (SDR, or PQ for HDR10), since the player's stats carry no dynamic
 * range. Direct files have no master, so they report decoded size only.
 */

const ATTR_RE = (name) => new RegExp(`(?:^|,)${name}=("[^"]*"|[^,]*)`)

/** The variants of an HLS master playlist. */
export function parseMasterVariants(text) {
  const variants = []
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue
    const attrs = line.slice('#EXT-X-STREAM-INF:'.length)
    const get = (name) => attrs.match(ATTR_RE(name))?.[1]?.replace(/"/g, '') ?? null
    const [width, height] = (get('RESOLUTION') ?? '').split('x').map(Number)
    variants.push({
      bandwidth: Number(get('BANDWIDTH')) || 0,
      width: width || 0,
      height: height || 0,
      videoRange: get('VIDEO-RANGE') ?? 'SDR',
    })
  }
  return variants
}

/** The variant whose BANDWIDTH the player reports, or the nearest one. */
export function matchVariant(variants, bitrate) {
  if (!variants?.length || !(bitrate > 0)) return null
  return variants.reduce((best, v) =>
    Math.abs(v.bandwidth - bitrate) < Math.abs(best.bandwidth - bitrate) ? v : best
  )
}

export function startNowPlayingReporter({ playerManager, castDebugLogger, logTag }) {
  const events = cast.framework.events.EventType
  const { messages } = cast.framework
  /** Variants of the master now loaded, keyed by its URL. */
  let variants = null
  let source = null
  /** Bitrate from the last BITRATE_CHANGED. */
  let bitrate = 0
  let nowPlaying = null

  const compute = () => {
    let stats = null
    try {
      stats = playerManager.getStats?.() ?? null
    } catch {
      /* not available on this build */
    }
    const variant = matchVariant(variants, bitrate || stats?.streamBandwidth || 0)
    // Decoded size first (what is really on screen), the playlist's second.
    const width = stats?.width || variant?.width || 0
    const height = stats?.height || variant?.height || 0
    if (!width || !height) return null
    return {
      width,
      height,
      bandwidth: variant?.bandwidth || bitrate || stats?.streamBandwidth || null,
      videoRange: variant?.videoRange ?? null,
    }
  }

  const publish = () => {
    const next = compute()
    if (JSON.stringify(next) === JSON.stringify(nowPlaying)) return
    nowPlaying = next
    castDebugLogger.debug(logTag, `nowPlaying: ${JSON.stringify(nowPlaying)}`)
    try {
      playerManager.broadcastStatus(false)
    } catch {
      /* nothing loaded yet */
    }
  }

  const loadVariants = async () => {
    const url = playerManager.getMediaInformation?.()?.contentUrl ?? null
    if (!url || url === source) return
    source = url
    variants = null
    if (!/\.m3u8(\?|$)/i.test(url)) return
    try {
      const response = await fetch(url)
      if (!response.ok || url !== source) return
      variants = parseMasterVariants(await response.text())
      publish()
    } catch (error) {
      castDebugLogger.warn(logTag, `nowPlaying: master fetch failed: ${error}`)
    }
  }

  playerManager.addEventListener(events.PLAYER_LOADING, () => {
    bitrate = 0
    nowPlaying = null
  })
  playerManager.addEventListener(events.PLAYER_LOAD_COMPLETE, () => {
    loadVariants()
    publish()
  })
  playerManager.addEventListener(events.BITRATE_CHANGED, (event) => {
    bitrate = event?.totalBitrate || 0
    publish()
  })
  // The decoded size can arrive after the bitrate, with the first frames.
  playerManager.addEventListener(events.PLAYING, publish)

  playerManager.setMessageInterceptor(messages.MessageType.MEDIA_STATUS, (status) => {
    if (!nowPlaying || !status) return status
    const hdr = nowPlaying.videoRange === 'PQ' || nowPlaying.videoRange === 'HLG'
    try {
      status.videoInfo = new messages.VideoInformation(
        nowPlaying.width,
        nowPlaying.height,
        hdr ? (messages.HdrType?.HDR ?? 'hdr') : (messages.HdrType?.SDR ?? 'sdr')
      )
    } catch {
      /* VideoInformation unavailable on this build: customData still carries it */
    }
    status.customData = { ...(status.customData ?? {}), nowPlaying }
    return status
  })
}
