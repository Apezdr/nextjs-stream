'use client'
import { isGoogleCastProvider, isHLSProvider } from '@vidstack/react'
import HLS from 'hls.js'

export function onProviderChange(provider, nativeEvent) {
  if (isHLSProvider(provider)) {
    provider.library = HLS
  }
}

export function onProviderSetup(provider, nativeEvent) {
  if (isGoogleCastProvider(provider)) {
    // Google Cast remote player.
    provider.player
    // Google Cast context.
    provider.cast
    // Google Cast session.
    provider.session
    // Google Cast media info.
    provider.media
    // Whether the session belongs to this provider.
    provider.hasActiveSession
  }
}
