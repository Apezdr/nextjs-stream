'use client'

import { signIn } from 'next-auth/react'
import GoogleButton from 'react-google-button'
import { DiscordLoginButton, FacebookLoginButton } from 'react-social-login-buttons'

export default function SignInButtons({ callbackUrl = '/list', enabledProviders = {} }) {
  const { google: isGoogleEnabled, discord: isDiscordEnabled, facebook: isFacebookEnabled } = enabledProviders

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
        <GoogleButton onClick={() => signIn('google', { callbackUrl: callbackUrl })} />
      )}
      {isDiscordEnabled && (
        <DiscordLoginButton
          className="max-w-[240px] !text-sm"
          onClick={() => signIn('discord', { callbackUrl: callbackUrl })}
        />
      )}
      {isFacebookEnabled && (
        <FacebookLoginButton
          className="max-w-[240px] !text-sm"
          onClick={() => signIn('facebook', { callbackUrl: callbackUrl })}
        />
      )}
    </>
  )
}
