import { getSession } from '../../../lib/cachedAuth'
import AuthGuard from '@components/MediaPages/DynamicPage/guards/AuthGuard'
import { withApprovedUser } from '@components/HOC/ApprovedUser'
import LandingPage from '@components/LandingPage'
import { Suspense } from 'react'

async function MediaDirectory() {
  const session = await getSession()
  
  const calendarConfig = {
    sonarr: !!process.env.SONARR_ICAL_LINK,
    radarr: !!process.env.RADARR_ICAL_LINK,
  }
  calendarConfig.hasAnyCalendar = calendarConfig.sonarr || calendarConfig.radarr
  
  return (
    <AuthGuard session={session} callbackUrl="/list" variant="skeleton">
      {session?.user && (
        <Suspense fallback={<div className='flex min-h-screen flex-col items-center justify-between xl:py-24 bg-[#060916e8]'></div>}>
          <LandingPage
            user={{
              id: session.user.id,
              name: session.user.name,
              email: session.user.email,
              limitedAccess: session.user.limitedAccess
            }}
            calendarConfig={calendarConfig}
          />
        </Suspense>
      )}
    </AuthGuard>
  )
}

export default withApprovedUser(MediaDirectory)
