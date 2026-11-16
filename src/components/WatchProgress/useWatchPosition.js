'use client'

import { useEffect } from 'react'
import { playbackStore } from './playbackStore'
import { pickProgress, usePlaybackTitle } from './useLiveProgress'

/**
 * This viewer's position in one title, for the surfaces that must know
 * whether there is one: the primary button's label, the resume panel, the
 * sticky bar's progress line.
 *
 * On a movie or episode details page the subtree is cached for everyone
 * (`'use cache'`), so nothing per-user renders on the server. The answer
 * comes from the positions store (playbackStore.js): the snapshot when the
 * title is among the viewer's recent ones, the seed the page's own render
 * handed in (PlaybackSeed), or else one request for this title, made by the
 * store once however many surfaces ask. Nothing is polled.
 *
 * A page that already joined the viewer's watch history on the server (the
 * show and season pages render per user) passes that object as
 * `watchHistory`: it is the answer, the store only overlays something newer,
 * and nothing is asked.
 *
 * `settled` is false while the answer is still on its way: a surface says
 * nothing about progress until then, so it never says "Play" and then
 * "Resume". `unknown` is true when the answer could not be had (the read
 * failed, or was refused: `refusal` is then the status): that is not "no
 * progress", and a surface that shows progress should say so.
 *
 * @param {Object} options
 * @param {string|null} [options.mediaId] - durable 'mid:…' identity
 * @param {string|null} [options.normalizedVideoId] - the hash of the title's file, as the server gave it
 * @param {string|null} [options.videoURL] - what the one request for this title names it by, beside its id; never a key
 * @param {number|null} [options.durationMs]
 * @param {Object|null} [options.watchHistory]
 * @returns {{ progress: ReturnType<typeof pickProgress>, settled: boolean, unknown: boolean, refusal: number|null }}
 */
export default function useWatchPosition({
  mediaId = null,
  normalizedVideoId = null,
  videoURL = null,
  durationMs = null,
  watchHistory = null,
}) {
  const mid = mediaId ?? watchHistory?.mediaId ?? null
  const nid = normalizedVideoId ?? watchHistory?.normalizedVideoId ?? null
  const seeded = watchHistory !== null
  const title = usePlaybackTitle(mid, nid)

  useEffect(() => {
    if (!seeded) playbackStore.want({ mediaId: mid, normalizedVideoId: nid, videoURL })
  }, [seeded, mid, nid, videoURL])

  return {
    progress: pickProgress({ watchHistory, entry: title.entry, durationMs }),
    // With no identity there is nothing to wait for
    settled: seeded || !(mid || nid) || title.answer !== 'pending',
    unknown: !seeded && title.answer === 'unknown',
    refusal: title.refusal,
  }
}
