import { auth } from '../../../lib/auth'
import UnauthenticatedPage from '@components/system/UnauthenticatedPage'
import SkeletonCard from '@components/SkeletonCard'
import { withApprovedUser } from '@components/HOC/ApprovedUser'
import WatchlistPage from '@components/Watchlist/WatchlistPage'

export const dynamic = 'force-dynamic'

async function WatchlistPageComponent() {
  const session = await auth()
  
  if (!session || !session.user) {
    return (
      <UnauthenticatedPage callbackUrl={'/watchlist'}>
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

  return <WatchlistPage user={{ name, email, limitedAccess }} />
}

export default withApprovedUser(WatchlistPageComponent)