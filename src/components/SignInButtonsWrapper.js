import SignInButtons from './SignInButtons'

export default function SignInButtonsWrapper({ callbackUrl = '/list' }) {
  // Check if auth providers are configured via environment variables (server-side)
  const enabledProviders = {
    google: !!(process.env.AUTH_GOOGLE_ID),
    discord: !!(process.env.AUTH_DISCORD_ID),
    facebook: !!(process.env.AUTH_FACEBOOK_ID),
  }

  return <SignInButtons callbackUrl={callbackUrl} enabledProviders={enabledProviders} />
}