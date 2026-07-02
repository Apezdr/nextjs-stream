import clientPromise from '@src/lib/mongodb'
import { userQueries } from '@src/lib/userQueries'
import { validateWebhookId } from '@src/utils/webhookServer'

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
    return { movieMap: new Map(), tvMap: new Map() }
  }

  const client = await clientPromise
  const mediaDb = client.db('Media')

  const [movies, episodes] = await Promise.all([
    mediaDb
      .collection('FlatMovies')
      .find(
        { videoURL: { $in: videoIds } },
        { projection: { title: 1, originalTitle: 1, videoURL: 1, duration: 1, dimensions: 1, size: 1, videoCodec: 1, metadata: 1 } }
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

  return { movieMap, tvMap }
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

function normalizeSession(entry, index, userMap, mediaMaps) {
  const movie = mediaMaps.movieMap.get(entry.videoId)
  const tv = mediaMaps.tvMap.get(entry.videoId)
  const user = userMap.get(String(entry.userId))
  const deviceType = entry.deviceInfo?.type || 'unknown'
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
      state,
      userName: user?.name || user?.email || 'Unknown User',
      userId: String(entry.userId),
      playerTitle: deviceType,
      product: 'NextJS Stream',
      platform: deviceType,
      lastUpdated: entry.lastUpdated,
      order: index + 1,
    }
  }

  if (tv) {
    const episode = tv.episode
    const seasonNumber = entry.seasonNumber || episode.seasonNumber || ''
    const episodeNumber = entry.episodeNumber || episode.episodeNumber || ''
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
      state,
      userName: user?.name || user?.email || 'Unknown User',
      userId: String(entry.userId),
      playerTitle: deviceType,
      product: 'NextJS Stream',
      platform: deviceType,
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
    state,
    userName: user?.name || user?.email || 'Unknown User',
    userId: String(entry.userId),
    playerTitle: deviceType,
    product: 'NextJS Stream',
    platform: deviceType,
    lastUpdated: entry.lastUpdated,
    order: index + 1,
  }
}

export async function getActiveMediaSessions(request) {
  const emptyPayload = buildEmptyMediaActivityPayload(request)
  const url = new URL(request.url)
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
    .sort({ lastUpdated: -1 })
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
  const sessions = entries.map((entry, index) => normalizeSession(entry, index, userMap, mediaMaps))

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
  ]
    .map(([key, value]) => `${key}="${xmlEscape(value)}"`)
    .join(' ')

  return `<Video ${attrs}><Media duration="${xmlEscape(durationMs)}" bitrate="${xmlEscape(session.bitrateKbps || 0)}" videoCodec="${xmlEscape(session.videoCodec || '')}" videoResolution="${xmlEscape(session.resolution || 'HD')}" container="mp4" videoDecision="copy" audioDecision="copy"><Part file="${xmlEscape(session.videoId)}" size="${xmlEscape(session.sizeBytes || 0)}" /></Media><User id="${xmlEscape(session.userId)}" title="${xmlEscape(session.userName)}" /><Player title="${xmlEscape(session.playerTitle)}" product="${xmlEscape(session.product)}" platform="${xmlEscape(session.platform)}" address="" state="${xmlEscape(session.state || 'playing')}" /><Session id="${xmlEscape(session.id)}" location="lan" /></Video>`
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