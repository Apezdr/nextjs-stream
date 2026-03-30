import SignInButtons from './SignInButtons'

export default function SignInButtonsWrapper({ callbackUrl = '/list' }) {
  // Check if auth providers are configured via environment variables (server-side)
  const enabledProviders = {
    google: !!(process.env.GOOGLE_CLIENT_ID),
    discord: !!(process.env.DISCORD_CLIENT_ID),
    facebook: !!(process.env.AUTH_FACEBOOK_ID),
  }

  return <SignInButtons callbackUrl={callbackUrl} enabledProviders={enabledProviders} />
}