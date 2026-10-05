'use client'

import { Suspense } from 'react'
import { NotificationProvider } from '@src/contexts/NotificationContext'
import { SystemStatusProvider } from '@src/contexts/SystemStatusContext'
import { NavigationProvider } from '@src/contexts/NavigationContext'
import CastSessionBar from '@components/Cast/CastSessionBar'
import CastPositionMirror from '@components/Cast/CastPositionMirror'
import Av1DecodeCheck from '@components/VideoPreview/Av1DecodeCheck'

/**
 * Client-side provider wrapper component
 * Handles all the context providers that require client-side rendering.
 * better-auth does not require a session provider wrapper.
 */
export default function ClientProviders({ children, castBootstrap = null }) {
  return (
    <NotificationProvider>
      <SystemStatusProvider>
        <NavigationProvider>
          {children}
          {/* A Cast session outlives the player that started it, so the
              indicator and its stop control live here, above the routes.
              The bootstrap is what lets them work after a full page load, on
              a page that never mounts a player and so never loads the SDK. */}
          {/* Passed in as a node: its receiver id is a request-time value, and
              reading it here would make this whole wrapper wait for a request
              (see the (styled) layout). */}
          {castBootstrap}
          {/* Records the receiver's progress while a session is live — from
              here rather than the watch page, because the session outlives any
              page and so must its reporter. */}
          <CastPositionMirror />
          {/* Asks the browser whether it plays AV1, once per page load. Here
              because this wrapper is on every page that shows hover previews
              and is loaded with the page; the preview player is not, and its
              first preview needs the answer before it mounts. */}
          <Av1DecodeCheck />
          {/* Its own boundary: the bar reads the pathname, which suspends during
              prerender on any route with URL params. Unwrapped, that one read
              suspended this whole provider tree and left those routes with an
              empty shell. */}
          <Suspense>
            <CastSessionBar />
          </Suspense>
        </NavigationProvider>
      </SystemStatusProvider>
    </NotificationProvider>
  )
}