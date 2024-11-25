'use client'

import GeneralFullScreenBackdrop from '@components/Backdrop/GeneralFullscreen'
import { AnimatePresence } from 'framer-motion'
import { useParams } from 'next/navigation'

export default function GeneralLayout({ posterCollage }) {
  const params = useParams()

  // Destructure parameters and decode if necessary
  const mediaType = params?.media?.[0] // 'movie' or 'tv'
  const mediaTitle = decodeURIComponent(params?.media?.[1] || '')

  const shouldShowGeneralLayout =
    (mediaType === 'tv' && !mediaTitle) ||
    (mediaType === 'movie' && !mediaTitle) ||
    (mediaType !== 'tv' && mediaType !== 'movie')

  return (
    <AnimatePresence mode="wait">
      {shouldShowGeneralLayout && (
        <GeneralFullScreenBackdrop
          key={'poster_collage'}
          url={posterCollage}
          imageClasses="opacity-25"
        />
      )}
    </AnimatePresence>
  )
}
