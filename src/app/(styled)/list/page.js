import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getSession } from '@src/lib/cachedAuth'
import AuthGuard from '@components/MediaPages/DynamicPage/guards/AuthGuard'
import LandingPage from '@components/LandingPage'
import LandingPageSkeleton from '@components/LandingPageSkeleton'

// Dynamic, authenticated content. The session is read HERE — inside the page's
// Suspense boundary — instead of at the top of the page/layout/HOC. That lets the
// static Partial Prerendering shell (LandingPageSkeleton) be served instantly while
// this user-specific content streams in, rather than blocking the whole page on a
// (sometimes slow) getSession() call.
//
// SECURITY: protected data is only fetched once `session?.user` is confirmed on the
// server. Unauthenticated requests resolve this hole to the sign-in skeleton and
// never receive LandingPage or any of its data. Do not hoist data fetching above
// this gate.
async function AuthedListContent() {
  const session = await getSession()

  // Approved-user gate (previously handled by the withApprovedUser HOC).
  if (session?.user && session.user.approved === false) {
    redirect('/auth/error?error=APPROVAL_PENDING')
  }

  const calendarConfig = {
    sonarr: !!process.env.SONARR_ICAL_LINK,
    radarr: !!process.env.RADARR_ICAL_LINK,
  }
  calendarConfig.hasAnyCalendar = calendarConfig.sonarr || calendarConfig.radarr

  return (
    <AuthGuard session={session} callbackUrl="/list" variant="skeleton">
      {session?.user && (
        <LandingPage
          user={{
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
            limitedAccess: session.user.limitedAccess,
          }}
          calendarConfig={calendarConfig}
        />
      )}
    </AuthGuard>
  )
}

export default function MediaDirectory() {
  return (
    <Suspense fallback={<LandingPageSkeleton />}>
      <AuthedListContent />
    </Suspense>
  )
}
