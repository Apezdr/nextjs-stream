'use client'

import { useEffect } from 'react'
import { authClient } from '@src/lib/auth-client'
import { normalizeAuthCallbackURL } from '@src/utils/authCallbackUrl'
import { clearPlaybackMirror } from '@components/SyncClientWithServerWatched'
import GoogleButton from 'react-google-button'
import { DiscordLoginButton, FacebookLoginButton } from 'react-social-login-buttons'

export default function SignInButtons({ callbackUrl = '/list', enabledProviders = {} }) {
  const { google: isGoogleEnabled, discord: isDiscordEnabled, facebook: isFacebookEnabled } = enabledProviders
  const normalizedCallbackUrl = normalizeAuthCallbackURL(callbackUrl, '/list')

  // Whoever signs in from here need not be whoever used this browser last
  // (a session that expired, a sign-out that did not go through
  // SignOutButton). The positions it mirrors are keyed by title, not by user,
  // so they go before the next account can read them as its own.
  useEffect(() => {
    clearPlaybackMirror()
  }, [])

  // Check if any auth providers are enabled
  const hasAnyProvider = isGoogleEnabled || isDiscordEnabled || isFacebookEnabled

  // If no providers are configured, show a message
  if (!hasAnyProvider) {
    return (
      <div className="text-center p-2 bg-yellow-50 border border-yellow-200 rounded-lg">
        <p className="text-yellow-800 font-medium">No authentication providers configured</p>
        <p className="text-yellow-600 text-sm mt-1">
          Please configure at least one authentication provider in your environment variables.
        </p>
      </div>
    )
  }

  return (
    <>
      {isGoogleEnabled && (
        <GoogleButton onClick={() => authClient.signIn.social({ provider: 'google', callbackURL: normalizedCallbackUrl })} />
      )}
      {isDiscordEnabled && (
        <DiscordLoginButton
          className="max-w-[240px] !text-sm"
          onClick={() => authClient.signIn.social({ provider: 'discord', callbackURL: normalizedCallbackUrl })}
        />
      )}
      {isFacebookEnabled && (
        <FacebookLoginButton
          className="max-w-[240px] !text-sm"
          onClick={() => authClient.signIn.social({ provider: 'facebook', callbackURL: normalizedCallbackUrl })}
        />
      )}
    </>
  )
}
