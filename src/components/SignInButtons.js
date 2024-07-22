'use client'

import { signIn } from 'next-auth/react'
import GoogleButton from 'react-google-button'
import { DiscordLoginButton } from 'react-social-login-buttons'

export default function SignInButtons({ callbackUrl = '/list' }) {
  return (
    <>
      <GoogleButton onClick={() => signIn('google', { callbackUrl: callbackUrl })} />
      <DiscordLoginButton
        className="max-w-[240px] !text-sm"
        onClick={() => signIn('discord', { callbackUrl: callbackUrl })}
      />
      {/* <FacebookLoginButton
        className="max-w-[240px] !text-sm"
        onClick={() => signIn('facebook', { callbackUrl: callbackUrl })}
      /> */}
    </>
  )
}
