import { auth } from '../../lib/auth'
import UnauthenticatedPage from '@components/system/UnauthenticatedPage'
import SkeletonCard from '@components/SkeletonCard'
import { withApprovedUser } from '@components/HOC/ApprovedUser'
import LandingPage from '@components/LandingPage'
import { getAvailableMedia } from '@src/utils/database'
import { Suspense } from 'react'
export const dynamic = 'force-dynamic'

async function MediaDirectory() {
  const session = await auth()
  if (!session || !session.user) {
    // Handle the case where the user is not authenticated
    return (
      <UnauthenticatedPage callbackUrl={'/list'}>
        <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl pb-8 xl:pb-0 px-4 xl:px-0">
          Please Sign in first
        </h2>
        <div className="border border-white border-opacity-30 rounded-lg p-3 overflow-hidden skeleton-container">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 overflow-hidden">
            <SkeletonCard />
            <SkeletonCard className="hidden md:block" />
            <SkeletonCard className="hidden lg:block" />
          </div>
        </div>
      </UnauthenticatedPage>
    )
  }
  const {
    user: { name, email, limitedAccess },
  } = session

  // sync up with the server
  //const serverVideoWatchedAmount = await getVideosWatched()
  const { moviesCount, tvprogramsCount, recentlyaddedCount, recentlywatchedCount } =
    await getAvailableMedia()
  return (
    <Suspense>
      <LandingPage
        user={{ name, email, limitedAccess }}
        moviesCount={moviesCount}
        tvprogramsCount={tvprogramsCount}
        recentlyaddedCount={recentlyaddedCount}
        recentlywatchedCount={recentlywatchedCount}
      />
    </Suspense>
  )
}

export default withApprovedUser(MediaDirectory)
