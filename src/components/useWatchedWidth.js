'use client'

import useLiveProgress from '@components/WatchProgress/useLiveProgress'
import { durationMsFrom } from '@components/WatchProgress/progress'
import { WATCH_COMPLETION_PERCENT } from '@src/utils/watchHistory/progress'

/**
 * Whether a title counts as finished. The server's `completed` (computed at
 * join time from the catalog duration, one threshold for every client) wins
 * when present; the live percentage against the same threshold is the
 * fallback for rows the server did not annotate.
 */
export function isWatchedComplete(media, watchedWidth) {
  const serverFlag = media?.watchHistory?.completed
  // The live width can cross the line after the server object was rendered
  // (the title finishing on another device), so either source may say done.
  return serverFlag === true || (Number.isFinite(watchedWidth) && watchedWidth >= WATCH_COMPLETION_PERCENT)
}

/**
 * A poster's or thumbnail's watched reading: the newer of the `watchHistory`
 * object the item was rendered with and what the positions store holds for
 * its title (useLiveProgress), against the item's runtime. One subscription
 * for the whole surface: the width of the bar (`progressPercent`), the clock
 * under it (`playbackTime`) and the "finished" overlay all read this.
 *
 * @param {Object|null|undefined} metadata - the item's TMDB metadata (its `runtime`, in minutes, when the file's is unknown)
 * @param {Object} media - the item: `watchHistory`, `mediaId`, `normalizedVideoId`, `duration` (ms)
 * @returns {ReturnType<typeof useLiveProgress>}
 */
export function useWatched(metadata, media) {
  return useLiveProgress({
    watchHistory: media?.watchHistory ?? null,
    mediaId: media?.mediaId ?? null,
    normalizedVideoId: media?.normalizedVideoId ?? null,
    durationMs: durationMsFrom({ duration: media?.duration, metadata }),
  })
}
