import { getActiveSessionsSummary } from '@src/utils/activeSessions'
import { isAdminOrWebhook } from '@src/utils/routeAuth'
import { getServerStatus } from '@src/utils/serverStatus'

/**
 * GET /api/rainmeter
 *
 * Returns active streaming session data in a JSON format optimized for
 * Rainmeter WebParser consumption. Mirrors the data structure of the Plex
 * Desktop Monitoring skin.
 *
 * Authentication: X-Webhook-ID header or ?webhookId= query parameter
 * (same credentials used by admin/sync endpoints)
 *
 * Response shape:
 * {
 *   serverName: string,
 *   serverStatus: 'online' | 'offline',
 *   streamCount: number,
 *   transcodeCount: number,
 *   directPlayCount: number,
 *   totalBandwidth: number,
 *   sessions: [
 *     {
 *       index: number,
 *       userName: string,
 *       mediaTitle: string,
 *       fullTitle: string,       // formatted "Title (Year)" or "Show - S01E01 - Episode"
 *       mediaType: string,       // "Movie", "TV Show"
 *       seasonEpisode: string,   // "Season 1 Episode 6" or ""
 *       quality: string,
 *       streamDecision: string,  // "Direct Play", "Transcoding"
 *       container: string,
 *       fileSize: string,        // human-readable
 *       filePath: string,
 *       bandwidth: string,       // human-readable
 *       deviceType: string,
 *       browserType: string,
 *       playbackDevice: string,  // "Chrome (Desktop)" formatted
 *       ipAddress: string,
 *       progress: number,
 *       progressFormatted: string, // "41.3%"
 *       duration: string,        // "HH:MM" total
 *       currentTime: string,     // "HH:MM" current position
 *       timeRemaining: string,   // "HH:MM" remaining
 *     }
 *   ]
 * }
 */
export async function GET(request) {
  // Authenticate via webhook ID (same as admin endpoints)
  const authResult = await isAdminOrWebhook(request)
  if (authResult instanceof Response) {
    return authResult
  }

  try {
    // Fetch active sessions and server status in parallel
    const [sessionSummary, serverStatus] = await Promise.all([
      getActiveSessionsSummary(),
      getServerStatus(),
    ])

    // Build the app name from env or default
    const appName = process.env.APP_NAME || 'Limitless Streaming'

    const response = {
      serverName: appName,
      serverStatus: serverStatus.ok ? 'online' : 'offline',
      streamCount: sessionSummary.streamCount,
      transcodeCount: sessionSummary.transcodeCount,
      directPlayCount: sessionSummary.directPlayCount,
      totalBandwidth: sessionSummary.totalBandwidth,
      sessions: sessionSummary.sessions.map((s) => {
        // Build formatted full title like Plex shows
        let fullTitle = s.mediaTitle || 'Unknown'
        if (s.year) fullTitle += ` (${s.year})`

        let seasonEpisode = ''
        if (s.mediaType === 'tv' && s.seasonNumber != null && s.episodeNumber != null) {
          seasonEpisode = `Season ${s.seasonNumber} Episode ${s.episodeNumber}`
        }

        // Format display title like Plex: "Show - S01E06 - Episode Title (Year)"
        let displayTitle = ''
        if (s.mediaType === 'tv') {
          const sNum = String(s.seasonNumber || 0).padStart(2, '0')
          const eNum = String(s.episodeNumber || 0).padStart(2, '0')
          displayTitle = `${s.showName || s.mediaTitle} - S${sNum}E${eNum}`
          if (s.episodeTitle) displayTitle += ` - ${s.episodeTitle}`
          if (s.year) displayTitle += ` (${s.year})`
        } else {
          displayTitle = fullTitle
        }

        // Format duration strings
        const currentTime = formatTime(s.playbackTime)
        const totalDuration = formatTime(s.duration)
        const remaining = s.duration
          ? formatTime(Math.max(0, s.duration - s.playbackTime))
          : '00:00'

        // Human-readable file size
        const fileSize = s.fileSize ? formatFileSize(s.fileSize) : ''

        // Human-readable bandwidth
        const bandwidth = s.bandwidth
          ? `${s.bandwidth} kbps (or ${(s.bandwidth / 1000).toFixed(1)} mbps)`
          : ''

        // Format playback device string like Plex
        const browserLabel = capitalize(s.browserType || 'Unknown')
        const deviceLabel = capitalize(s.deviceType || 'Unknown')
        const playbackDevice = `${browserLabel} (${deviceLabel})`

        // Stream decision display
        const streamDecisionDisplay =
          s.streamDecision === 'transcode' ? 'Transcoding' : 'Direct Play'

        // Quality display with codec info
        let qualityDisplay = s.quality || ''
        if (s.videoCodec) {
          qualityDisplay += qualityDisplay ? ` (${s.videoCodec.toUpperCase()})` : s.videoCodec.toUpperCase()
        }

        return {
          index: s.index,
          userName: s.userName,
          mediaTitle: s.mediaTitle,
          displayTitle,
          fullTitle,
          mediaType: s.mediaType === 'tv' ? 'TV Show' : s.mediaType === 'movie' ? 'Movie' : s.mediaType,
          seasonEpisode,
          quality: qualityDisplay,
          qualityResolution: s.quality || '',
          videoCodec: s.videoCodec || '',
          audioCodec: s.audioCodec || '',
          streamDecision: streamDecisionDisplay,
          mediaDecision: s.streamDecision === 'transcode' ? 'Transcode' : 'Copy',
          container: s.container ? `(${s.container})` : '',
          fileSize,
          filePath: s.filePath || '',
          bandwidth,
          bandwidthKbps: s.bandwidth || 0,
          deviceType: deviceLabel,
          browserType: browserLabel,
          playbackDevice,
          ipAddress: s.ipAddress || '',
          progress: s.progress,
          progressFormatted: `${s.progress.toFixed(1)}%`,
          duration: totalDuration,
          currentTime,
          currentTimeSeconds: Math.round(s.playbackTime || 0),
          durationSeconds: Math.round(s.duration || 0),
          timeRemaining: remaining,
          serverName: s.serverName || appName,
        }
      }),
    }

    return Response.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
    })
  } catch (err) {
    console.error('Error in Rainmeter API:', err)
    return Response.json(
      {
        serverName: process.env.APP_NAME || 'Limitless Streaming',
        serverStatus: 'error',
        streamCount: 0,
        transcodeCount: 0,
        directPlayCount: 0,
        totalBandwidth: 0,
        sessions: [],
        error: 'Failed to fetch session data',
      },
      { status: 200 }
    )
  }
}

/**
 * Format seconds into "H:MM" or "M:SS" display
 */
function formatTime(seconds) {
  if (!seconds || seconds <= 0) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)

  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Format file size in bytes to human-readable string
 */
function formatFileSize(bytes) {
  if (!bytes) return ''
  const gb = bytes / (1024 * 1024 * 1024)
  if (gb >= 1) return `${gb.toFixed(2)} GB`
  const mb = bytes / (1024 * 1024)
  return `${mb.toFixed(0)} MB`
}

/**
 * Capitalize first letter
 */
function capitalize(str) {
  if (!str) return ''
  return str.charAt(0).toUpperCase() + str.slice(1)
}
