'use client'

import GeneralFullScreenBackdrop from '@components/Backdrop/GeneralFullscreen'
import { AnimatePresence } from 'framer-motion'
import { usePathname } from 'next/navigation'
import { authClient } from '@src/lib/auth-client'

export default function GeneralLayout({ posterCollage }) {
  const { data: session, isPending } = authClient.useSession()
  const pathname = usePathname()

  // Detect whether we're on a media-detail route (where the per-media
  // FullScreenBackdrop should take over). Anything that is NOT a movie or
  // TV detail page falls through to the generic poster-collage backdrop.
  // Trailing slash check: `/list/movie` (the list) is not a detail page;
  // `/list/movie/<title>` and below are.
  const isMovieDetail = pathname?.startsWith('/list/movie/') ?? false
  const isTVDetail = pathname?.startsWith('/list/tv/') ?? false
  const isMediaDetail = isMovieDetail || isTVDetail

  const shouldShowGeneralLayout =
    !isMediaDetail || ((isPending || !session) && isMediaDetail)

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
