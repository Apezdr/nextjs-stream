'use client'

import FullScreenBackdrop from '@components/Backdrop/FullScreen'
import { AnimatePresence } from 'framer-motion'
import { useParams } from 'next/navigation'
import { useState, useEffect } from 'react'

export default function TVLayout({ posterCollage }) {
  const routeParams = useParams()
  const [params, setParams] = useState(routeParams)
  const [media, setMedia] = useState(null)

  // Destructure parameters and decode if necessary
  const mediaType = params?.media?.[0] // 'movie' or 'tv'
  const mediaTitle = decodeURIComponent(params?.media?.[1] || '')
  const mediaSeason = params?.media?.[2] // Could be 'Season X'
  const mediaEpisode = params?.media?.[3] // Could be 'Episode Y'

  useEffect(() => {
    setParams(routeParams)
  }, [routeParams])

  useEffect(() => {
    if (media && media.title !== mediaTitle) {
      setMedia(null)
    }

    if (mediaType === 'tv' && mediaTitle && (!media || media.title !== mediaTitle)) {
      fetch('/api/authenticated/media', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mediaType,
          mediaTitle,
          mediaSeason,
          mediaEpisode,
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
  }, [params]) // Dependency array

  const hasBackdropAvailable = media?.backdrop?.length || media?.metadata?.backdrop_path

  return (
    <AnimatePresence mode="wait">
      {mediaType === 'tv' && mediaTitle && media && hasBackdropAvailable ? (
        <FullScreenBackdrop key={mediaTitle} media={media} />
      ) : null}
    </AnimatePresence>
  )
}
