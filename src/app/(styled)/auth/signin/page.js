// Dedicated sign-in page. Reached from two places:
//   - /api/authz/verify (forward-auth for reverse-proxied apps like Organizr), which
//     sends an absolute external callbackUrl — the page says which app you're
//     going back to so landing there after login isn't a surprise.
//   - internal pages that want a plain redirect instead of an inline AuthGuard.
// The callback is validated here again, independently of the verify route.
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { getSession } from '@src/lib/cachedAuth'
import { siteTitle } from '@src/utils/config'
import { isGatedAuthUrl } from '@src/utils/gatedAuthOrigins'
import { resolveSignInCallback } from '@src/utils/authCallbackUrl'
import SignInButtonsWrapper from '@components/SignInButtonsWrapper'

export const metadata = {
  title: `Sign in - ${siteTitle}`,
}

export default async function SignInPage({ searchParams }) {
  await connection()
  const params = await searchParams
  const { callbackUrl, isExternal, destinationHost } = resolveSignInCallback(params?.callbackUrl, {
    isAllowedExternal: isGatedAuthUrl,
  })

  const session = await getSession()
  if (session?.user) {
    // Already signed in: skip the buttons and go where they were headed.
    redirect(callbackUrl)
  }

  return (
    <main className="sm:mx-auto sm:max-w-7xl sm:px-6 lg:px-8">
      <div className="flex min-h-screen flex-col items-center justify-center px-4 py-24 sm:px-6">
        <div className="relative isolate w-full max-w-lg overflow-hidden rounded-3xl bg-gray-900 px-6 py-12 text-center shadow-2xl ring-1 ring-white/10 sm:px-12">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">{siteTitle}</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-white">Sign in to continue</h2>

          {isExternal ? (
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 px-5 py-4">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">You&apos;ll be sent back to</p>
              <p className="mt-1.5 flex items-center justify-center gap-2 text-base font-semibold text-white">
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-gray-400">
                  <path
                    fillRule="evenodd"
                    d="M4.25 5.5a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 0 0 .75-.75v-4a.75.75 0 0 1 1.5 0v4A2.25 2.25 0 0 1 12.75 17h-8.5A2.25 2.25 0 0 1 2 14.75v-8.5A2.25 2.25 0 0 1 4.25 4h5a.75.75 0 0 1 0 1.5h-5Zm7.5-2.5a.75.75 0 0 0 0 1.5h2.69l-5.72 5.72a.75.75 0 1 0 1.06 1.06L15.5 5.56v2.69a.75.75 0 0 0 1.5 0V3.75a.75.75 0 0 0-.75-.75h-4.5Z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="break-all">{destinationHost}</span>
              </p>
              <p className="mt-2 text-sm text-gray-400">{`That app signs in with your ${siteTitle} account.`}</p>
            </div>
          ) : (
            <p className="mt-3 text-gray-400">You&apos;ll be returned to where you left off.</p>
          )}

          <div className="mt-8 flex flex-col items-center gap-y-3">
            <SignInButtonsWrapper callbackUrl={callbackUrl} />
          </div>
        </div>
      </div>
    </main>
  )
}
