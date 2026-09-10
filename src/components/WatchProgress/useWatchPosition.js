'use client'

import useSWR from 'swr'
import { fetcher } from '@src/utils'
import useLiveProgress from './useLiveProgress'

/** Server re-read cadence; the local mirror covers the gaps at 5 s. */
export const POSITION_REFRESH_MS = 15000

/**
 * This viewer's position in one title, for the details page.
 *
 * The details subtree is cached for everyone (`'use cache'`), so nothing
 * per-user can render on the server; every surface that needs the position
 * (the resume panel, the primary button's label, the sticky bar's progress
 * line) calls this hook instead. They share one SWR key, so the network
 * cost is one request per page regardless of how many surfaces read it.
 *
 * The per-title endpoint resolves by URL, hash and durable mediaId and
 * carries `completed` / `progressPercent`; it is re-read every 15 s and on
 * focus so a film playing on the Shield moves the bar here. The local
 * mirror (useLiveProgress) fills the first paint and the seconds between.
 *
 * @param {{ videoURL: string|null, mediaId?: string|null, durationMs?: number|null }} options
 * @returns {{ progress: ReturnType<typeof useLiveProgress>, settled: boolean }}
 */
export default function useWatchPosition({ videoURL, mediaId = null, durationMs = null }) {
  const key = videoURL ? `/api/authenticated/sync/playback?videoId=${encodeURIComponent(videoURL)}` : null
  const { data, error, isLoading } = useSWR(key, fetcher, {
    revalidateOnFocus: true,
    refreshInterval: POSITION_REFRESH_MS,
    dedupingInterval: 5000,
  })

  const watchHistory =
    data && data.found
      ? {
          playbackTime: data.playbackTime,
          progressPercent: data.progressPercent,
          completed: data.completed,
          lastWatched: data.lastUpdated,
        }
      : null

  const progress = useLiveProgress({ watchHistory, mediaId, videoURL, durationMs })

  return { progress, settled: !key || data !== undefined || Boolean(error) || !isLoading }
}
