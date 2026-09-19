'use client'

import { NotificationProvider } from '@src/contexts/NotificationContext'
import { SystemStatusProvider } from '@src/contexts/SystemStatusContext'
import { NavigationProvider } from '@src/contexts/NavigationContext'
import CastSessionBar from '@components/Cast/CastSessionBar'
import CastBootstrap from '@components/Cast/CastBootstrap'
import CastPositionMirror from '@components/Cast/CastPositionMirror'

/**
 * Client-side provider wrapper component
 * Handles all the context providers that require client-side rendering.
 * better-auth does not require a session provider wrapper.
 */
export default function ClientProviders({ children, castReceiverId = null }) {
  return (
    <NotificationProvider>
      <SystemStatusProvider>
        <NavigationProvider>
          {children}
          {/* A Cast session outlives the player that started it, so the
              indicator and its stop control live here, above the routes.
              The bootstrap is what lets them work after a full page load, on
              a page that never mounts a player and so never loads the SDK. */}
          <CastBootstrap receiverId={castReceiverId} />
          {/* Records the receiver's progress while a session is live — from
              here rather than the watch page, because the session outlives any
              page and so must its reporter. */}
          <CastPositionMirror />
          <CastSessionBar />
        </NavigationProvider>
      </SystemStatusProvider>
    </NotificationProvider>
  )
}