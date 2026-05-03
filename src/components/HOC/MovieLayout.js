'use client'

import FullScreenBackdrop from '@components/Backdrop/FullScreen'
import { AnimatePresence } from 'framer-motion'
import { useParams, usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { authClient } from '@src/lib/auth-client'

export default function MovieLayout({ posterCollage }) {
  const routeParams = useParams()
  const pathname = usePathname()
  const [params, setParams] = useState(routeParams)
  const [media, setMedia] = useState(null)

  // Get client-side session to check authentication before API calls
  const { data: session, isPending } = authClient.useSession()

  // Detect media type from the URL path (the explicit `/list/movie/[title]`
  // routes don't have a `params.media[]` array like the old catch-all did).
  // Trailing slash matters: `/list/movie` is the list view (no specific
  // movie), `/list/movie/<title>` is a detail page.
  const isMoviePath = pathname?.startsWith('/list/movie/') ?? false
  const mediaType = isMoviePath ? 'movie' : null
  const mediaTitle = decodeURIComponent(params?.title || '')

  useEffect(() => {
    setParams(routeParams)
  }, [routeParams])

  useEffect(() => {
    // Don't fetch if not authenticated or still loading session
    if (!session?.user || isPending) {
      return
    }

    if (media && media.title !== mediaTitle) {
      setMedia(null)
    }

    if (mediaType === 'movie' && mediaTitle && (!media || media.title !== mediaTitle)) {
      fetch('/api/authenticated/media', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mediaType,
          mediaTitle,
        }),
      })
        .then((response) => {
          if (response.ok) {
            return response.json() // Return the parsed JSON from the response
          } else {
            throw new Error('Media fetch failed')
          }
        })
        .then((data) => {
          setMedia(data)
        })
        .catch((error) => {
          console.error('Fetch error:', error)
        })
    }
  }, [params, session, isPending]) // Include session and isPending in dependencies

  const hasBackdropAvailable = media?.backdrop?.length || media?.metadata?.backdrop_path

  return (
    <AnimatePresence mode="wait">
      {session?.user && mediaType === 'movie' && mediaTitle && media && hasBackdropAvailable ? (
        <FullScreenBackdrop key={mediaTitle} media={media} />
      ) : null}
    </AnimatePresence>
  )
}
