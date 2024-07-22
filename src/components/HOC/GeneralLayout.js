'use client'

import GeneralFullScreenBackdrop from '@components/Backdrop/GeneralFullscreen'
import { AnimatePresence } from 'framer-motion'
import { useParams } from 'next/navigation'

export default function GeneralLayout({ fileServerURL }) {
  const params = useParams()

  // Destructure parameters and decode if necessary
  const mediaType = params?.media?.[0] // 'movie' or 'tv'
  const mediaTitle = decodeURIComponent(params?.media?.[1] || '')
  //const mediaSeason = params?.media?.[2] // Could be 'Season X'
  //const mediaEpisode = params?.media?.[3] // Could be 'Episode Y'

  return (
    <AnimatePresence mode="wait">
      {((mediaType === 'tv' && !mediaTitle) || mediaType !== 'tv') && (
        <GeneralFullScreenBackdrop
          key={'poster_collage'}
          url={fileServerURL + `/poster_collage.jpg`}
          imageClasses="opacity-25"
        />
      )}
    </AnimatePresence>
  )
}
