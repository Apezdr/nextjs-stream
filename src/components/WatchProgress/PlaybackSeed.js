'use client'

import { useEffect } from 'react'
import { playbackStore } from './playbackStore'

/**
 * Hands the positions store the answer the page's server render read for its
 * title, as the page hydrates: no request, and no wait for the snapshot.
 *
 * It exists for the movie and episode details pages, whose HTML is cached
 * for every viewer and so cannot say "Resume" by itself (see
 * TitlePlaybackSeed, which reads the row beside that cached subtree).
 *
 * The router can replay a page it was sent up to 30 s ago, seed and all, and
 * a page shown again runs this effect again: the store keeps whichever answer
 * the server gave later (`entry.asOf`), so an old seed never replaces newer
 * news. Renders nothing.
 *
 * @param {Object} props
 * @param {string} props.userId - the user the page was rendered for
 * @param {{ mediaId: string|null, normalizedVideoId: string|null }} props.title - the title's identities, as the catalog holds them
 * @param {{ found: boolean, mediaId?: string|null, normalizedVideoId?: string|null, playbackTime?: number, lastUpdated?: string|null, asOf: string }} props.entry
 */
export default function PlaybackSeed({ userId, title, entry }) {
  useEffect(() => {
    playbackStore.seed({ userId, title, entry })
  }, [userId, title, entry])
  return null
}
