'use client'

import { NotificationProvider } from '@src/contexts/NotificationContext'
import { SystemStatusProvider } from '@src/contexts/SystemStatusContext'
import { NavigationProvider } from '@src/contexts/NavigationContext'

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
        </NavigationProvider>
      </SystemStatusProvider>
    </NotificationProvider>
  )
}