import { Suspense } from 'react'
import { getSession } from '@src/lib/cachedAuth'
import AuthGuard from '@components/MediaPages/DynamicPage/guards/AuthGuard'
import { withApprovedUser } from '@components/HOC/ApprovedUser'
import WatchlistPage from '@components/Watchlist/WatchlistPage'
import { WatchlistPageSkeleton } from '@components/Watchlist/WatchlistSkeletons'

async function WatchlistPageComponent() {
  const session = await getSession()

  return (
    <AuthGuard session={session} callbackUrl="/watchlist" variant="skeleton">
      {session?.user && <WatchlistPage user={session.user} />}
    </AuthGuard>
  )
}

// The same approval check and session read as before, unchanged. They now run
// INSIDE a Suspense boundary instead of at the top of the page: whatever a page
// awaits at its top is absent from the route's prerendered shell, which left
// this route with an empty one. The skeleton is the shell now, so a link to
// "My List" has the page's frame ready before the click.
const ApprovedWatchlist = withApprovedUser(WatchlistPageComponent)

export default function WatchlistRoute() {
  return (
    <Suspense fallback={<WatchlistPageSkeleton />}>
      <ApprovedWatchlist />
    </Suspense>
  )
}
