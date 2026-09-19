'use client'

import GeneralFullScreenBackdrop from '@components/Backdrop/GeneralFullscreen'
import { AnimatePresence } from 'framer-motion'
import { usePathname } from 'next/navigation'
import { useSyncExternalStore } from 'react'
import { authClient } from '@src/lib/auth-client'

export default function GeneralLayout({ posterCollage }) {
  const { data: session, isPending } = authClient.useSession()
  const pathname = usePathname()

  // useSyncExternalStore with a server snapshot of `false` is the official
  // React API for client-only values, and the same guard StatusBannerClient
  // uses for the same reason. Without it this component hydrates wrong on every
  // media-detail route: during SSR there is no session, so `isPending` is true
  // and the server renders the backdrop — while on the client's first render
  // better-auth resolves from its cookie cache synchronously, `isPending` is
  // already false, and nothing renders. Server said "div", client said "no
  // div". Deferring the session read until after hydration makes the first
  // client render reproduce the server's exactly.
  const isMounted = useSyncExternalStore(
    (cb) => {
      cb()
      return () => {}
    },
    () => true, // client snapshot: always mounted in the browser
    () => false // server snapshot: never mounted during SSR
  )

  // Detect whether we're on a media-detail route (where the per-media
  // FullScreenBackdrop should take over). Anything that is NOT a movie or
  // TV detail page falls through to the generic poster-collage backdrop.
  // Trailing slash check: `/list/movie` (the list) is not a detail page;
  // `/list/movie/<title>` and below are.
  const isMovieDetail = pathname?.startsWith('/list/movie/') ?? false
  const isTVDetail = pathname?.startsWith('/list/tv/') ?? false
  const isMediaDetail = isMovieDetail || isTVDetail

  // Before hydration the session is not knowable, so treat it as pending —
  // which is exactly what the server did.
  const sessionUnresolved = !isMounted || isPending || !session

  const shouldShowGeneralLayout = !isMediaDetail || sessionUnresolved

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
