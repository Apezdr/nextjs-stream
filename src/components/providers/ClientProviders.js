'use client'

import { SessionProvider } from 'next-auth/react'
import { NotificationProvider } from '@src/contexts/NotificationContext'
import { SystemStatusProvider } from '@src/contexts/SystemStatusContext'
import { NavigationProvider } from '@src/contexts/NavigationContext'

/**
 * Client-side provider wrapper component
 * Handles all the context providers that require client-side rendering
 */
export default function ClientProviders({ children }) {
  return (
    <SessionProvider>
      <NotificationProvider>
        <SystemStatusProvider>
          <NavigationProvider>
            {children}
          </NavigationProvider>
        </SystemStatusProvider>
      </NotificationProvider>
    </SessionProvider>
  )
}