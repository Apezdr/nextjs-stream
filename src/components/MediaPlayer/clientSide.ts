'use client'
import {
  isGoogleCastProvider,
  isHLSProvider,
  type HLSProvider,
  type GoogleCastProvider,
  type MediaProviderAdapter,
} from '@vidstack/react'
import HLS from 'hls.js'

export function onProviderChange(provider: MediaProviderAdapter | null) {
  if (isGoogleCastProvider(provider)) {
    // Access the Google Cast session
    const castProvider = provider as GoogleCastProvider
    // Google Cast remote player.
    castProvider.player
    // Google Cast context.
    castProvider.cast
    // Google Cast session.
    castProvider.session
    // Google Cast media info.
    castProvider.media
    // Whether the session belongs to this provider.
    castProvider.hasActiveSession
  }
  if (isHLSProvider(provider)) {
    provider.library = HLS
  }
}

export function onProviderSetup(provider: MediaProviderAdapter, nativeEvent: Event) {
  if (isGoogleCastProvider(provider)) {
    const castProvider = provider as GoogleCastProvider
    // Google Cast remote player.
    castProvider.player
    // Google Cast context.
    castProvider.cast
    // Google Cast session.
    castProvider.session
    // Google Cast media info.
    castProvider.media
    // Whether the session belongs to this provider.
    castProvider.hasActiveSession
  }
}
