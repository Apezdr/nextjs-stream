'use client'

import useLiveProgress from '@components/WatchProgress/useLiveProgress'
import { nextUpLine } from '@src/utils/media/tvFacts'

/**
 * The line under the show page's primary button: "Pilot · 8:29 watched ·
 * 56m left". The server picks the episode; this keeps its position live
 * (the server object, and the positions store over it) so the line moves
 * while the episode plays on another device.
 *
 * @param {Object} props
 * @param {{ kind: string, episode: { title?: string|null, metadata?: { name?: string|null }, seasonNumber: number, episodeNumber: number, mediaId?: string|null, normalizedVideoId?: string|null, durationMs?: number|null, watchHistory?: Object|null } }} props.nextUp
 * @param {number} props.totalEpisodes
 * @param {string} [props.className]
 */
export default function ShowNextUpLine({ nextUp, totalEpisodes, className = '' }) {
  const episode = nextUp?.episode || {}
  const progress = useLiveProgress({
    watchHistory: episode.watchHistory ?? null,
    mediaId: episode.mediaId ?? null,
    normalizedVideoId: episode.normalizedVideoId ?? null,
    durationMs: episode.durationMs ?? null,
  })
  const text = nextUpLine({ nextUp, progress, totalEpisodes })
  return text ? <p className={className}>{text}</p> : null
}
