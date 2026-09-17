'use client'

import FullScreenBackdrop from '@components/Backdrop/FullScreen'
import { AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { useParams, usePathname } from 'next/navigation'
import useSWR from 'swr'
import { authClient } from '@src/lib/auth-client'

// Always the SHOW's media, never a season's or an episode's: see the key below.
const fetchMedia = async ([, mediaType, mediaOriginalTitle]) => {
  const response = await fetch('/api/authenticated/media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mediaType, mediaOriginalTitle }),
  })
  if (!response.ok) {
    throw new Error('Media fetch failed')
  }
  return response.json()
}

export default function TVLayout({ posterCollage }) {
  const routeParams = useParams()
  const pathname = usePathname()
  const [displayMedia, setDisplayMedia] = useState(null)
  const [prevBackdropTitle, setPrevBackdropTitle] = useState(null)

  // Get client-side session to check authentication before API calls
  const { data: session, isPending } = authClient.useSession()

  // Detect media type from the URL path (the explicit
  // `/list/tv/[title]/[season]/[episode]` routes don't have a `params.media[]`
  // array like the old catch-all did). Trailing slash matters: `/list/tv` is
  // the list view (no specific show), `/list/tv/<title>` and below are detail.
  const isTVPath = pathname?.startsWith('/list/tv/') ?? false
  const mediaType = isTVPath ? 'tv' : null
  const mediaOriginalTitle = decodeURIComponent(routeParams?.title || '')

  // Fetch backdrop media via SWR; the key is null (and no request fires) until
  // the user is authenticated and we're on a specific TV detail route.
  //
  // The key is the show alone, deliberately not the season or episode. This
  // component sits in the root layout, the one part of the screen that stays
  // mounted across every navigation; keyed per episode it refetched, and the
  // episode payload's backdrop is that episode's still, so the whole
  // background was torn down and rebuilt between two episodes of the same
  // show. One backdrop per show keeps the page behind show, season and episode
  // pages perfectly still while the content in front of it changes. The
  // episode's still has its own place in the episode page's hero.
  const titleKey = mediaType === 'tv' && mediaOriginalTitle ? mediaOriginalTitle : null
  const swrKey =
    session?.user && !isPending && titleKey
      ? ['tv-layout-media', mediaType, mediaOriginalTitle]
      : null
  const { data: media } = useSWR(swrKey, fetchMedia)

  const isRouteMatchedShow = media?.originalTitle === mediaOriginalTitle
  const hasBackdropAvailable = media?.backdrop?.length || media?.metadata?.backdrop_path
  const nextDisplayMedia =
    mediaType === 'tv' && mediaOriginalTitle && isRouteMatchedShow && hasBackdropAvailable
      ? media
      : null

  // Clear on a change of SHOW (or on leaving the TV detail routes, where the
  // title becomes null) so the outgoing title's backdrop never sits under the
  // incoming title's page. Not on every pathname change: season and episode
  // pages of one show share the backdrop, and clearing it there blanked the
  // background on each step through a season. Derived state during render,
  // not an effect, so no frame commits the wrong backdrop.
  if (titleKey !== prevBackdropTitle) {
    setPrevBackdropTitle(titleKey)
    if (displayMedia !== null) {
      setDisplayMedia(null)
    }
  } else if (displayMedia !== nextDisplayMedia) {
    setDisplayMedia(nextDisplayMedia)
  }

  return (
    <AnimatePresence mode="wait">
      {session?.user && mediaType === 'tv' && mediaOriginalTitle && displayMedia ? (
        <FullScreenBackdrop key={mediaOriginalTitle} media={displayMedia} />
      ) : null}
    </AnimatePresence>
  )
}
