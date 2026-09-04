'use client'

import FullScreenBackdrop from '@components/Backdrop/FullScreen'
import { AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { useParams, usePathname } from 'next/navigation'
import useSWR from 'swr'
import { authClient } from '@src/lib/auth-client'

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

export default function MovieLayout({ posterCollage }) {
  const routeParams = useParams()
  const pathname = usePathname()
  const [displayMedia, setDisplayMedia] = useState(null)
  const [prevBackdropPathname, setPrevBackdropPathname] = useState(pathname)

  // Get client-side session to check authentication before API calls
  const { data: session, isPending } = authClient.useSession()

  // Detect media type from the URL path (the explicit `/list/movie/[title]`
  // routes don't have a `params.media[]` array like the old catch-all did).
  // Trailing slash matters: `/list/movie` is the list view (no specific
  // movie), `/list/movie/<title>` is a detail page.
  const isMoviePath = pathname?.startsWith('/list/movie/') ?? false
  const mediaType = isMoviePath ? 'movie' : null
  const mediaOriginalTitle = decodeURIComponent(routeParams?.title || '')

  // Fetch backdrop media via SWR; the key is null (and no request fires) until
  // the user is authenticated and we're on a specific movie detail route.
  const swrKey =
    session?.user && !isPending && mediaType === 'movie' && mediaOriginalTitle
      ? ['movie-layout-media', mediaType, mediaOriginalTitle]
      : null
  const { data: media } = useSWR(swrKey, fetchMedia)

  const isRouteMatchedMovie = media?.originalTitle === mediaOriginalTitle
  const hasBackdropAvailable = media?.backdrop?.length || media?.metadata?.backdrop_path
  const nextDisplayMedia =
    mediaType === 'movie' && mediaOriginalTitle && isRouteMatchedMovie && hasBackdropAvailable
      ? media
      : null

  if (pathname !== prevBackdropPathname) {
    setPrevBackdropPathname(pathname)
    if (displayMedia !== null) {
      setDisplayMedia(null)
    }
  } else if (displayMedia !== nextDisplayMedia) {
    setDisplayMedia(nextDisplayMedia)
  }

  return (
    <AnimatePresence mode="wait">
      {session?.user && mediaType === 'movie' && mediaOriginalTitle && displayMedia ? (
        <FullScreenBackdrop key={mediaOriginalTitle} media={displayMedia} />
      ) : null}
    </AnimatePresence>
  )
}
