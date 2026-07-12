import clientPromise from '@src/lib/mongodb'
import { userQueries } from '@src/lib/userQueries'
import { validateWebhookId } from '@src/utils/webhookServer'
import { detectBrowserType, getDeviceTypeLabel } from '@src/utils/deviceDetection'
import { UAParser } from 'ua-parser-js'

const DEFAULT_ACTIVE_WINDOW_SECONDS = 15
const MAX_ACTIVE_WINDOW_SECONDS = 300
const PAUSED_WINDOW_SECONDS = 3600
const DEFAULT_LIMIT = 10
const LOOKUP_TIMEOUT_MS = 3000

function clampNumber(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function getActivityToken(request) {
  const url = new URL(request.url)
  return (
    request.headers.get('X-Media-Activity-Token') ||
    request.headers.get('X-Webhook-ID') ||
    request.headers.get('X-API-Key') ||
    url.searchParams.get('apiKey') ||
    url.searchParams.get('webhookId') ||
    url.searchParams.get('token')
  )
}

export async function validateMediaActivityRequest(request) {
  const token = getActivityToken(request)
  const activityApiKeys = [process.env.MEDIA_ACTIVITY_API_KEY].filter(Boolean)

  if (activityApiKeys.includes(token)) {
    return { isValid: true, source: 'media-activity-api-key' }
  }

  const webhookValidation = await validateWebhookId(token)
  if (webhookValidation.isValid) {
    return { isValid: true, source: 'webhook', serverId: webhookValidation.serverId }
  }

  return { isValid: false }
}

async function getMediaMaps(videoIds) {
  if (videoIds.length === 0) {
    return { movieMap: new Map(), tvMap: new Map(), showPosterMap: new Map() }
  }

  const client = await clientPromise
  const mediaDb = client.db('Media')

  const [movies, episodes] = await Promise.all([
    mediaDb
      .collection('FlatMovies')
      .find(
        { videoURL: { $in: videoIds } },
        { projection: { title: 1, originalTitle: 1, videoURL: 1, duration: 1, dimensions: 1, size: 1, videoCodec: 1, posterURL: 1, metadata: 1 } }
      )
      .toArray(),
    mediaDb
      .collection('FlatEpisodes')
      .find(
        { videoURL: { $in: videoIds } },
        {
          projection: {
            showTitle: 1,
            originalTitle: 1,
            seasonNumber: 1,
            episodeNumber: 1,
            title: 1,
            videoURL: 1,
            duration: 1,
            dimensions: 1,
            size: 1,
            videoCodec: 1,
            airDate: 1,
            thumbnail: 1,
            posterURL: 1,
            metadata: 1,
          },
        }
      )
      .toArray(),
  ])

  const movieMap = new Map(movies.map((movie) => [movie.videoURL, movie]))
  const tvMap = new Map()

  for (const episode of episodes) {
    tvMap.set(episode.videoURL, { episode })
  }

  // Resolve show-level posters for any episodes so the widget can show a proper
  // vertical poster (episodes only carry a horizontal `thumbnail`).
  const showTitles = [...new Set(episodes.map((episode) => episode.showTitle).filter(Boolean))]
  let showPosterMap = new Map()
  if (showTitles.length > 0) {
    const shows = await mediaDb
      .collection('FlatTVShows')
      .find(
        { title: { $in: showTitles } },
        { projection: { title: 1, posterURL: 1, metadata: 1 } }
      )
      .toArray()
    showPosterMap = new Map(shows.map((show) => [show.title, show]))
  }

  return { movieMap, tvMap, showPosterMap }
}

function getTitleFromVideoId(videoId) {
  const fallback = videoId?.split('/').filter(Boolean).pop() || 'Unknown Media'
  try {
    return decodeURIComponent(fallback).replace(/\.[^.]+$/, '')
  } catch {
    return fallback.replace(/\.[^.]+$/, '')
  }
}

function getResolutionLabel(dimensions) {
  const height = Number.parseInt(String(dimensions || '').split('x')[1], 10)
  if (!Number.isFinite(height)) return ''
  if (height >= 2000) return '2160p'
  if (height >= 1000) return '1080p'
  if (height >= 700) return '720p'
  if (height >= 400) return '480p'
  return `${height}p`
}

function getYearFromDate(value) {
  if (!value) return ''
  const year = new Date(value).getFullYear()
  return Number.isFinite(year) ? year : ''
}

function getBitrateKbps(sizeBytes, durationMs) {
  const bytes = Number(sizeBytes) || 0
  const seconds = (Number(durationMs) || 0) / 1000
  if (bytes <= 0 || seconds <= 0) return 0
  return Math.round((bytes * 8) / seconds / 1000)
}

// Resolves a downloadable poster URL. Rainmeter's WebParser needs an absolute
// URL, while older records and the application fallback can be root-relative.
function resolvePosterUrl(appOrigin, posterURL, posterPath, fallback = '') {
  const value = posterURL || (posterPath ? `https://image.tmdb.org/t/p/w500${posterPath}` : fallback)

  try {
    return new URL(value || '/sorry-image-not-available.jpg', appOrigin).toString()
  } catch {
    return new URL('/sorry-image-not-available.jpg', appOrigin).toString()
  }
}

/**
 * Builds a human-friendly device descriptor for the <Player> element from the
 * stored deviceInfo — using the same user-agent the admin activity panel uses for
 * its device/browser icons — so the widget shows e.g. "Chrome · Desktop" with
 * platform "Windows" instead of just "desktop".
 */
function getDeviceDescriptor(deviceInfo) {
  const typeLabel = getDeviceTypeLabel(deviceInfo?.type)
  const userAgent = deviceInfo?.userAgent || ''

  let browser = ''
  let os = ''
  if (userAgent) {
    const detected = detectBrowserType(userAgent)
    if (detected && detected !== 'unknown') {
      browser = detected.charAt(0).toUpperCase() + detected.slice(1)
    }
    try {
      os = new UAParser(userAgent).getOS()?.name || ''
    } catch {
      os = ''
    }
  }

  const hasType = typeLabel && typeLabel !== 'Unknown'
  const title = browser
    ? (hasType ? `${browser} · ${typeLabel}` : browser)
    : (hasType ? typeLabel : (deviceInfo?.type || 'Unknown'))

  return {
    title,
    platform: os || (hasType ? typeLabel : (deviceInfo?.type || '')),
    product: 'NextJS Stream',
  }
}

function normalizeSession(entry, index, userMap, mediaMaps, appOrigin) {
  const movie = mediaMaps.movieMap.get(entry.videoId)
  const tv = mediaMaps.tvMap.get(entry.videoId)
  const user = userMap.get(String(entry.userId))
  const device = getDeviceDescriptor(entry.deviceInfo)
  // Player/network fields shared by every session shape below.
  const player = {
    playerTitle: device.title,
    product: device.product,
    platform: device.platform,
    address: entry.ipAddress || '',
    localAddress: entry.localIp || '',
  }
  const playbackMs = Math.max(0, Math.round((entry.playbackTime || 0) * 1000))
  const state = entry.isPaused ? 'paused' : 'playing'

  if (movie) {
    return {
      id: `${String(entry._id)}`,
      key: `/metadata/${String(entry._id)}`,
      type: 'movie',
      title: movie.title || movie.originalTitle || getTitleFromVideoId(entry.videoId),
      grandparentTitle: '',
      parentTitle: '',
      seasonNumber: '',
      episodeNumber: '',
      year: getYearFromDate(movie.metadata?.release_date),
      durationMs: movie.duration || 0,
      playbackMs,
      videoId: entry.videoId,
      resolution: getResolutionLabel(movie.dimensions),
      sizeBytes: Number(movie.size) || 0,
      bitrateKbps: getBitrateKbps(movie.size, movie.duration),
      videoCodec: movie.videoCodec || '',
      posterUrl: resolvePosterUrl(appOrigin, movie.posterURL, movie.metadata?.poster_path),
      state,
      userName: user?.name || user?.email || 'Unknown User',
      userId: String(entry.userId),
      ...player,
      lastUpdated: entry.lastUpdated,
      order: index + 1,
    }
  }

  if (tv) {
    const episode = tv.episode
    const seasonNumber = entry.seasonNumber || episode.seasonNumber || ''
    const episodeNumber = entry.episodeNumber || episode.episodeNumber || ''
    const show = mediaMaps.showPosterMap?.get(episode.showTitle)
    return {
      id: `${String(entry._id)}`,
      key: `/metadata/${String(entry._id)}`,
      type: 'episode',
      title: episode.title || getTitleFromVideoId(entry.videoId),
      grandparentTitle: episode.showTitle || episode.originalTitle || 'Unknown Show',
      parentTitle: `Season ${seasonNumber}`.trim(),
      seasonNumber,
      episodeNumber,
      year: getYearFromDate(episode.airDate || episode.metadata?.air_date),
      durationMs: episode.duration || 0,
      playbackMs,
      videoId: entry.videoId,
      resolution: getResolutionLabel(episode.dimensions),
      sizeBytes: Number(episode.size) || 0,
      bitrateKbps: getBitrateKbps(episode.size, episode.duration),
      videoCodec: episode.videoCodec || '',
      posterUrl: resolvePosterUrl(
        appOrigin,
        show?.posterURL,
        show?.metadata?.poster_path,
        episode.thumbnail || (episode.metadata?.still_path
          ? `https://image.tmdb.org/t/p/w500${episode.metadata.still_path}`
          : '')
      ),
      state,
      userName: user?.name || user?.email || 'Unknown User',
      userId: String(entry.userId),
      ...player,
      lastUpdated: entry.lastUpdated,
      order: index + 1,
    }
  }

  return {
    id: `${String(entry._id)}`,
    key: `/metadata/${String(entry._id)}`,
    type: entry.mediaType === 'tv' ? 'episode' : 'movie',
    title: getTitleFromVideoId(entry.videoId),
    grandparentTitle: '',
    parentTitle: '',
    seasonNumber: entry.seasonNumber || '',
    episodeNumber: entry.episodeNumber || '',
    year: '',
    durationMs: 0,
    playbackMs,
    videoId: entry.videoId,
    resolution: '',
    sizeBytes: 0,
    bitrateKbps: 0,
    videoCodec: '',
    posterUrl: resolvePosterUrl(appOrigin),
    state,
    userName: user?.name || user?.email || 'Unknown User',
    userId: String(entry.userId),
    ...player,
    lastUpdated: entry.lastUpdated,
    order: index + 1,
  }
}

export async function getActiveMediaSessions(request) {
  const emptyPayload = buildEmptyMediaActivityPayload(request)
  const url = new URL(request.url)
  const appOrigin = url.origin
  const activeWindowSeconds = clampNumber(
    url.searchParams.get('activeWindowSeconds'),
    DEFAULT_ACTIVE_WINDOW_SECONDS,
    1,
    MAX_ACTIVE_WINDOW_SECONDS
  )
  const limit = clampNumber(url.searchParams.get('limit'), DEFAULT_LIMIT, 1, DEFAULT_LIMIT)
  const activeSince = new Date(Date.now() - activeWindowSeconds * 1000)
  const pausedSince = new Date(Date.now() - PAUSED_WINDOW_SECONDS * 1000)

  const client = await clientPromise
  const entries = await client
    .db('Media')
    .collection('WatchHistory')
    .find({
      $or: [
        { lastUpdated: { $gte: activeSince } },
        { isPaused: true, lastUpdated: { $gte: pausedSince } },
      ],
    })
    // Keep each stream in its original row while playback heartbeats update
    // `lastUpdated`. MongoDB `_id` is immutable, so pause/resume cannot reorder
    // existing streams; newly-created entries are appended chronologically.
    .sort({ _id: 1 })
    .limit(limit)
    .toArray()

  if (entries.length === 0) {
    return emptyPayload
  }

  const userIds = [...new Set(entries.map((entry) => entry.userId).filter(Boolean))]
  const videoIds = [...new Set(entries.map((entry) => entry.videoId).filter(Boolean))]

  const [users, mediaMaps] = await Promise.all([
    userIds.length > 0
      ? userQueries.find({ _id: { $in: userIds } }, { name: 1, email: 1 })
      : Promise.resolve([]),
    getMediaMaps(videoIds),
  ])

  const userMap = new Map(users.map((user) => [String(user._id), user]))
  const sessions = entries.map((entry, index) =>
    normalizeSession(entry, index, userMap, mediaMaps, appOrigin)
  )

  return {
    available: true,
    activeWindowSeconds,
    streamCount: sessions.length,
    transcodeCount: 0,
    sessions,
    updatedAt: new Date().toISOString(),
  }
}

export async function getActiveMediaSessionsOrUnavailable(request, errorMessage) {
  const unavailablePayload = () => buildEmptyMediaActivityPayload(request, {
    available: false,
    error: errorMessage || 'Media activity temporarily unavailable',
  })

  const lookup = getActiveMediaSessions(request).catch((error) => {
    console.error('Media activity lookup failed:', error)
    return unavailablePayload()
  })

  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve(unavailablePayload()), LOOKUP_TIMEOUT_MS)
  })

  return Promise.race([lookup, timeout])
}

export function buildEmptyMediaActivityPayload(request, options = {}) {
  const url = new URL(request.url)
  return {
    available: options.available !== false,
    error: options.error || null,
    activeWindowSeconds: clampNumber(
      url.searchParams.get('activeWindowSeconds'),
      DEFAULT_ACTIVE_WINDOW_SECONDS,
      1,
      MAX_ACTIVE_WINDOW_SECONDS
    ),
    streamCount: 0,
    transcodeCount: 0,
    sessions: [],
    updatedAt: new Date().toISOString(),
  }
}

export function buildMediaActivitySummary(payload) {
  const summary = {
    name: 'NextJS Stream',
    available: payload.available !== false,
    streamCount: payload.streamCount,
    transcodeCount: payload.transcodeCount,
    activeWindowSeconds: payload.activeWindowSeconds,
    updatedAt: payload.updatedAt,
    sessions: payload.sessions,
  }

  if (payload.error) {
    summary.error = payload.error
  }

  return summary
}

export function buildSessionMetadataXml(session) {
  if (!session) {
    return '<MediaContainer size="0" />'
  }

  return `<MediaContainer size="1">${buildSessionXml(session)}</MediaContainer>`
}

export function buildSessionListXml(payload) {
  const videos = payload.sessions.map((session) => buildSessionXml(session)).join('')
  const availabilityAttr = payload.available === false ? ' status="unavailable"' : ''
  return `<MediaContainer size="${payload.streamCount}" friendlyName="NextJS Stream" machineIdentifier="nextjs-stream"${availabilityAttr}>${videos}</MediaContainer>`
}

export function buildTranscodeListXml() {
  return '<MediaContainer size="0" />'
}

function buildSessionXml(session) {
  const durationMs = Math.max(session.durationMs || session.playbackMs || 0, session.playbackMs || 0)
  const attrs = [
    ['ratingKey', session.id],
    ['guid', `nextjs-stream://${session.id}`],
    ['key', session.key],
    ['type', session.type],
    ['title', session.title],
    ['grandparentTitle', session.grandparentTitle],
    ['parentTitle', session.parentTitle],
    ['parentIndex', session.seasonNumber],
    ['index', session.episodeNumber],
    ['Index', session.episodeNumber],
    ['year', session.year],
    ['duration', durationMs],
    ['viewOffset', session.playbackMs],
    ['thumb', session.posterUrl],
    ['art', session.posterUrl],
  ]
    .map(([key, value]) => `${key}="${xmlEscape(value)}"`)
    .join(' ')

  const bitrate = session.bitrateKbps || 0
  // Direct-play only (mp4, no server-side transcode). The skin maps this via
  // #VideoDecisions# ("directplay":"Direct Play"). A <Stream> child carries the
  // bitrate + decision the skin's Stream Bitrate / Media Decision measures expect.
  const decision = 'directplay'

  // NOTE: attribute ORDER matters — the desktop skin's regexes assume the Plex/Tautulli
  // layout. <Player address="…"> must lead (its IP measure matches `<Player address="`),
  // and title must have an attribute before it (its device measure matches `<Player .* title="`).
  return `<Video ${attrs}><Media duration="${xmlEscape(durationMs)}" bitrate="${xmlEscape(bitrate)}" videoCodec="${xmlEscape(session.videoCodec || '')}" videoResolution="${xmlEscape(session.resolution || 'HD')}" container="mp4" decision="${decision}" videoDecision="${decision}" audioDecision="${decision}"><Part file="${xmlEscape(session.videoId)}" size="${xmlEscape(session.sizeBytes || 0)}" decision="${decision}"><Stream streamType="1" decision="${decision}" codec="${xmlEscape(session.videoCodec || '')}" bitrate="${xmlEscape(bitrate)}" /></Part></Media><User id="${xmlEscape(session.userId)}" title="${xmlEscape(session.userName)}" /><Player address="${xmlEscape(session.address || session.localAddress || '')}" title="${xmlEscape(session.playerTitle)}" product="${xmlEscape(session.product)}" platform="${xmlEscape(session.platform)}" state="${xmlEscape(session.state || 'playing')}" local="1" localAddress="${xmlEscape(session.localAddress || '')}" /><Session id="${xmlEscape(session.id)}" location="lan" /></Video>`
}

export function xmlResponse(xml, status = 200) {
  return new Response(xml, {
    status,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'private, no-store',
    },
  })
}

export function unauthorizedMediaActivityResponse() {
  return new Response(JSON.stringify({ error: 'Invalid media activity token' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  })
}