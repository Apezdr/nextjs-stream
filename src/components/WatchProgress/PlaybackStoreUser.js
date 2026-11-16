'use client'

import { useEffect } from 'react'
import { playbackStore } from './playbackStore'

/**
 * Tells the positions store whose document this is: the user the layout was
 * rendered for. The store asks for nothing until it is told, names that user
 * on every request, and holds nothing for a document rendered for no one.
 *
 * The layout stays mounted across client navigations, so this is the
 * document's user until the next full load. If the layout is ever rendered
 * again for someone else (the account changed in another tab), the store
 * takes that as the refusal it is and empties. Renders nothing.
 *
 * @param {{ userId: string|null }} props
 */
export default function PlaybackStoreUser({ userId = null }) {
  useEffect(() => {
    playbackStore.identify(userId)
  }, [userId])
  return null
}
