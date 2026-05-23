'use client'

import FullScreenBackdrop from '@components/Backdrop/FullScreen'
import { AnimatePresence } from 'framer-motion'
import { useParams, usePathname } from 'next/navigation'
import useSWR from 'swr'
import { authClient } from '@src/lib/auth-client'

const fetchMedia = async ([, mediaType, mediaTitle, mediaSeason, mediaEpisode]) => {
  const response = await fetch('/api/authenticated/media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mediaType, mediaTitle, mediaSeason, mediaEpisode }),
  })
  if (!response.ok) {
    throw new Error('Media fetch failed')
  }
  return response.json()
}

export default function TVLayout({ posterCollage }) {
  const routeParams = useParams()
  const pathname = usePathname()

  // Get client-side session to check authentication before API calls
  const { data: session, isPending } = authClient.useSession()

  // Detect media type from the URL path (the explicit
  // `/list/tv/[title]/[season]/[episode]` routes don't have a `params.media[]`
  // array like the old catch-all did). Trailing slash matters: `/list/tv` is
  // the list view (no specific show), `/list/tv/<title>` and below are detail.
  const isTVPath = pathname?.startsWith('/list/tv/') ?? false
  const mediaType = isTVPath ? 'tv' : null
  const mediaTitle = decodeURIComponent(routeParams?.title || '')
  const mediaSeason = routeParams?.season || undefined
  const mediaEpisode = routeParams?.episode || undefined

  // Fetch backdrop media via SWR; the key is null (and no request fires) until
  // the user is authenticated and we're on a specific TV detail route.
  const swrKey =
    session?.user && !isPending && mediaType === 'tv' && mediaTitle
      ? ['tv-layout-media', mediaType, mediaTitle, mediaSeason, mediaEpisode]
      : null
  const { data: media } = useSWR(swrKey, fetchMedia)

  const hasBackdropAvailable = media?.backdrop?.length || media?.metadata?.backdrop_path

  return (
    <AnimatePresence mode="wait">
      {session?.user && mediaType === 'tv' && mediaTitle && media && hasBackdropAvailable ? (
        <FullScreenBackdrop key={mediaTitle} media={media} />
      ) : null}
    </AnimatePresence>
  )
}
