import { getSession } from '@src/lib/cachedAuth'
import AuthGuard from '@components/MediaPages/DynamicPage/guards/AuthGuard'
import { withApprovedUser } from '@components/HOC/ApprovedUser'
import WatchlistPage from '@components/Watchlist/WatchlistPage'

async function WatchlistPageComponent() {
  const session = await getSession()
  
  return (
    <AuthGuard session={session} callbackUrl="/watchlist" variant="skeleton">
      {session?.user && <WatchlistPage user={session.user} />}
    </AuthGuard>
  )
}

export default withApprovedUser(WatchlistPageComponent)