import { Suspense } from 'react'
import { getSession } from '@src/lib/cachedAuth'
import AuthGuard from '@components/MediaPages/DynamicPage/guards/AuthGuard'
import { withApprovedUser } from '@components/HOC/ApprovedUser'
import CreditsCatalogPage from '@components/Credits/CreditsCatalogPage'

async function CreditsPageComponent() {
  const session = await getSession()
  return (
    <AuthGuard session={session} callbackUrl="/list/credits" variant="skeleton">
      {session?.user && <CreditsCatalogPage user={session.user} />}
    </AuthGuard>
  )
}

// The session read and approval check run inside a Suspense boundary, as on
// the watchlist page, so the route's prerendered shell is not empty.
const ApprovedCredits = withApprovedUser(CreditsPageComponent)

export const metadata = { title: 'Credits & licenses' }

export default function CreditsRoute() {
  return (
    <Suspense fallback={<div className="mx-auto h-96 w-full max-w-5xl animate-pulse px-4 pt-28" />}>
      <ApprovedCredits />
    </Suspense>
  )
}
