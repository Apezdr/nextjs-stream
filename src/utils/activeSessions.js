import clientPromise from '@src/lib/mongodb'
import { ObjectId } from 'mongodb'
import { detectDeviceType, detectBrowserType } from '@src/utils/deviceDetection'

/**
 * Active Sessions Utility
 *
 * Tracks real-time playback sessions in a dedicated MongoDB collection.
 * Sessions are created/updated via heartbeat pings from the media player
 * and expire automatically after a configurable timeout (default: 90 seconds).
 *
 * Collection: ActiveSessions (database: Media)
 *
 * Document shape:
 * {
 *   _id: ObjectId,
 *   sessionId: string,        // unique per user+video combo
 *   userId: ObjectId,
 *   userName: string,
 *   videoId: string,
 *   mediaTitle: string,       // display title of the media
 *   mediaType: 'movie' | 'tv',
 *   showName: string | null,  // TV show name (if tv)
 *   seasonNumber: number | null,
 *   episodeNumber: number | null,
 *   episodeTitle: string | null,
 *   year: number | null,
 *   duration: number | null,  // total duration in seconds
 *   playbackTime: number,     // current position in seconds
 *   progress: number,         // 0-100 percentage
 *   quality: string | null,   // e.g. "1080p", "4K"
 *   videoCodec: string | null,
 *   audioCodec: string | null,
 *   container: string | null, // e.g. "mkv", "mp4"
 *   fileSize: number | null,  // bytes
 *   filePath: string | null,
 *   streamDecision: string,   // 'directplay' | 'transcode'
 *   bandwidth: number | null, // kbps
 *   deviceType: string,       // 'desktop', 'mobile', 'tablet', 'tv'
 *   browserType: string,      // 'chrome', 'edge', 'firefox', etc.
 *   platform: string | null,  // OS info
 *   ipAddress: string | null,
 *   serverName: string | null,
 *   lastHeartbeat: Date,
 *   startedAt: Date,
 *   expiresAt: Date           // TTL index for auto-cleanup
 * }
 */

const SESSION_TIMEOUT_SECONDS = 90 // Consider session dead after 90s without heartbeat
const DB_NAME = 'Media'
const COLLECTION_NAME = 'ActiveSessions'

/**
 * Ensures the TTL index exists on expiresAt for auto-cleanup of stale sessions
 */
let indexEnsured = false
async function ensureIndexes(collection) {
  if (indexEnsured) return
  try {
    await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
    await collection.createIndex({ sessionId: 1 }, { unique: true })
    await collection.createIndex({ userId: 1 })
    indexEnsured = true
  } catch (err) {
    // Indexes may already exist, that's fine
    if (!err.message?.includes('already exists')) {
      console.error('Error creating ActiveSessions indexes:', err)
    }
    indexEnsured = true
  }
}

/**
 * Generate a deterministic session ID from userId + videoId
 */
function generateSessionId(userId, videoId) {
  return `${userId}::${videoId}`
}

/**
 * Update or create an active session (called on each heartbeat)
 */
export async function upsertActiveSession({
  userId,
  userName,
  videoId,
  mediaTitle,
  mediaType,
  showName = null,
  seasonNumber = null,
  episodeNumber = null,
  episodeTitle = null,
  year = null,
  duration = null,
  playbackTime = 0,
  quality = null,
  videoCodec = null,
  audioCodec = null,
  container = null,
  fileSize = null,
  filePath = null,
  bandwidth = null,
  serverName = null,
  userAgent = null,
  ipAddress = null,
}) {
  const client = await clientPromise
  const db = client.db(DB_NAME)
  const collection = db.collection(COLLECTION_NAME)
  await ensureIndexes(collection)

  const userIdObj = typeof userId === 'string' ? new ObjectId(userId) : userId
  const sessionId = generateSessionId(userIdObj.toString(), videoId)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + SESSION_TIMEOUT_SECONDS * 1000)

  // Calculate progress percentage
  const progress = duration && duration > 0 ? Math.min(100, (playbackTime / duration) * 100) : 0

  // Detect device info from user agent
  const deviceType = userAgent ? detectDeviceType(userAgent) || 'desktop' : 'desktop'
  const browserType = userAgent ? detectBrowserType(userAgent) || 'unknown' : 'unknown'

  // All media is direct play from the file server (no transcoding in this app)
  const streamDecision = 'directplay'

  const sessionData = {
    sessionId,
    userId: userIdObj,
    userName: userName || 'Unknown',
    videoId,
    mediaTitle: mediaTitle || 'Unknown',
    mediaType: mediaType || 'unknown',
    showName,
    seasonNumber,
    episodeNumber,
    episodeTitle,
    year,
    duration,
    playbackTime,
    progress: Math.round(progress * 10) / 10,
    quality,
    videoCodec,
    audioCodec,
    container,
    fileSize,
    filePath,
    streamDecision,
    bandwidth,
    deviceType,
    browserType,
    platform: userAgent || null,
    ipAddress,
    serverName,
    lastHeartbeat: now,
    expiresAt,
  }

  await collection.updateOne(
    { sessionId },
    {
      $set: sessionData,
      $setOnInsert: { startedAt: now },
    },
    { upsert: true }
  )

  return sessionData
}

/**
 * Remove an active session (called when playback stops)
 */
export async function removeActiveSession(userId, videoId) {
  const client = await clientPromise
  const db = client.db(DB_NAME)
  const collection = db.collection(COLLECTION_NAME)

  const userIdObj = typeof userId === 'string' ? new ObjectId(userId) : userId
  const sessionId = generateSessionId(userIdObj.toString(), videoId)

  await collection.deleteOne({ sessionId })
}

/**
 * Get all currently active sessions (not expired)
 */
export async function getActiveSessions() {
  const client = await clientPromise
  const db = client.db(DB_NAME)
  const collection = db.collection(COLLECTION_NAME)
  await ensureIndexes(collection)

  const now = new Date()
  const sessions = await collection
    .find({ expiresAt: { $gt: now } })
    .sort({ lastHeartbeat: -1 })
    .toArray()

  return sessions
}

/**
 * Get a summary of active sessions for Rainmeter consumption
 * Returns a flat, easily parseable structure
 */
export async function getActiveSessionsSummary() {
  const sessions = await getActiveSessions()

  const streamCount = sessions.length
  const transcodeCount = sessions.filter((s) => s.streamDecision === 'transcode').length
  const directPlayCount = sessions.filter((s) => s.streamDecision === 'directplay').length

  // Calculate total bandwidth
  const totalBandwidth = sessions.reduce((sum, s) => sum + (s.bandwidth || 0), 0)

  return {
    streamCount,
    transcodeCount,
    directPlayCount,
    totalBandwidth,
    sessions: sessions.map((s, index) => ({
      index: index + 1,
      userName: s.userName,
      mediaTitle: s.mediaTitle,
      mediaType: s.mediaType,
      showName: s.showName,
      seasonNumber: s.seasonNumber,
      episodeNumber: s.episodeNumber,
      episodeTitle: s.episodeTitle,
      year: s.year,
      duration: s.duration,
      playbackTime: s.playbackTime,
      progress: s.progress,
      quality: s.quality,
      videoCodec: s.videoCodec,
      audioCodec: s.audioCodec,
      container: s.container,
      fileSize: s.fileSize,
      filePath: s.filePath,
      streamDecision: s.streamDecision,
      bandwidth: s.bandwidth,
      deviceType: s.deviceType,
      browserType: s.browserType,
      ipAddress: s.ipAddress,
      serverName: s.serverName,
      startedAt: s.startedAt,
      durationWatching: s.startedAt
        ? Math.round((new Date() - new Date(s.startedAt)) / 1000)
        : 0,
    })),
  }
}
