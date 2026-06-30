'use client'

import FullScreenBackdrop from '@components/Backdrop/FullScreen'
import { AnimatePresence } from 'framer-motion'
import { useParams, usePathname } from 'next/navigation'
import useSWR from 'swr'
import { authClient } from '@src/lib/auth-client'

const fetchMedia = async ([, mediaType, mediaTitle]) => {
  const response = await fetch('/api/authenticated/media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mediaType, mediaTitle }),
  })
  if (!response.ok) {
    throw new Error('Media fetch failed')
  }
  return response.json()
}

export default function MovieLayout({ posterCollage }) {
  const routeParams = useParams()
  const pathname = usePathname()

  // Get client-side session to check authentication before API calls
  const { data: session, isPending } = authClient.useSession()

  // Detect media type from the URL path (the explicit `/list/movie/[title]`
  // routes don't have a `params.media[]` array like the old catch-all did).
  // Trailing slash matters: `/list/movie` is the list view (no specific
  // movie), `/list/movie/<title>` is a detail page.
  const isMoviePath = pathname?.startsWith('/list/movie/') ?? false
  const mediaType = isMoviePath ? 'movie' : null
  const mediaTitle = decodeURIComponent(routeParams?.title || '')

  // Fetch backdrop media via SWR; the key is null (and no request fires) until
  // the user is authenticated and we're on a specific movie detail route.
  const swrKey =
    session?.user && !isPending && mediaType === 'movie' && mediaTitle
      ? ['movie-layout-media', mediaType, mediaTitle]
      : null
  const { data: media } = useSWR(swrKey, fetchMedia)

  const hasBackdropAvailable = media?.backdrop?.length || media?.metadata?.backdrop_path

  return (
    <AnimatePresence mode="wait">
      {session?.user && mediaType === 'movie' && mediaTitle && media && hasBackdropAvailable ? (
        <FullScreenBackdrop key={mediaTitle} media={media} />
      ) : null}
    </AnimatePresence>
  )
}
