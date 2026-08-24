'use client'

import { NotificationProvider } from '@src/contexts/NotificationContext'
import { SystemStatusProvider } from '@src/contexts/SystemStatusContext'
import { NavigationProvider } from '@src/contexts/NavigationContext'
import CastSessionBar from '@components/Cast/CastSessionBar'

/**
 * Client-side provider wrapper component
 * Handles all the context providers that require client-side rendering.
 * better-auth does not require a session provider wrapper.
 */
export default function ClientProviders({ children }) {
  return (
    <NotificationProvider>
      <SystemStatusProvider>
        <NavigationProvider>
          {children}
          {/* A Cast session outlives the player that started it, so the
              indicator and its stop control live here, above the routes. */}
          <CastSessionBar />
        </NavigationProvider>
      </SystemStatusProvider>
    </NotificationProvider>
  )
}