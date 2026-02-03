import { Suspense, lazy } from 'react'
import { cacheLife } from 'next/cache'
import Loading from '@src/app/loading'
import SyncClientWithServerWatched from './SyncClientWithServerWatched'
import HorizontalScrollContainer from '@src/components/MediaScroll/HorizontalScrollContainer'
import RecommendationSectionTitle from './RecommendationSectionTitle'
import AsyncMediaCounts from './AsyncMediaCounts'

const ReleaseCalendar = lazy(() => import('./Calendar/ReleaseCalendar'))

// Cacheable welcome section - static content that can be prerendered
async function WelcomeSection({ userName }) {
  "use cache"
  cacheLife('navigation') // Static UI elements - 5min client, 1hr server, 1 day expire

  return (
    <div className="h-auto flex pt-12 lg:py-0 px-4 xl:px-0 relative">
      <ul className="grid grid-cols-1 sm:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8 sm:gap-x-6 xl:gap-x-8">
        <li className="col-span-1 sm:col-span-2">
          <h2 className="max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl pb-8 xl:pb-0 px-4 xl:px-0 self-baseline">
            Welcome {userName.split(' ')[0]},
          </h2>
          <h2 className="text-xl font-bold tracking-tight text-white pb-8 xl:pb-0 px-4 xl:px-0">
            <AsyncMediaCounts suffix={` Available TV Shows & Movies`} showDuration={true} />
          </h2>
        </li>
      </ul>
    </div>
  )
}

// Cacheable static media section - doesn't need user data and can be prerendered
async function StaticMediaSections() {
  "use cache"
  cacheLife('mediaLists') // Media library lists - 1min client/server, 5min expire

  return (
    <>
      <h2 className="text-xl font-bold text-left mt-4 ml-4">Recently Added</h2>
      <Suspense>
        <HorizontalScrollContainer type="recentlyAdded" />
      </Suspense>
      <h2 className="text-xl font-bold text-left mt-4 ml-4">Movies</h2>
      <Suspense>
        <HorizontalScrollContainer type="movie" sort="id" sortOrder="asc" />
      </Suspense>
      <h2 className="text-xl font-bold text-left mt-4 ml-4">TV</h2>
      <Suspense>
        <HorizontalScrollContainer type="tv" sort="id" sortOrder="asc" />
      </Suspense>
    </>
  )
}

// Calendar section - separate because ReleaseCalendar is a client component
async function CalendarSection({ calendarConfig }) {
  if (!calendarConfig.hasAnyCalendar) {
    return null
  }
  
  return (
    <Suspense>
      <ReleaseCalendar calendarConfig={calendarConfig} />
    </Suspense>
  )
}

// User-dependent sections that need user data and can't be cached
async function UserDependentSections({ user }) {
  return (
    <>
      <h2 className="text-xl font-bold text-left mt-4 ml-4">Watch History</h2>
      <Suspense>
        <HorizontalScrollContainer type="recentlyWatched" user={user} />
      </Suspense>
    </>
  )
}

// User-specific content with private per-user caching
// IMPORTANT: Uses "use cache: private" because data is personalized per-user
async function UserSpecificSections({ user }) {
  "use cache: private"
  cacheLife('userContent') // Per-user cache: 1min client, 15min server, 1hr expire

  const { getCachedUserPlaylistSections } = await import('@src/utils/cache/userPlaylistSections')
  const { getUserPlaylists, listVisiblePlaylists } = await import('@src/utils/watchlist')

  // Load per-user "Show in App" playlist rows using private cache
  let appRows = []
  try {
    if (user?.id) {
      // Pass userId as primitive parameter to enable proper caching
      const allPlaylists = await getUserPlaylists(user.id, true, true)
      const visibilityPrefs = await listVisiblePlaylists(user.id)

      // Use cached function with private per-user caching (nested private cache is allowed)
      const userPlaylistSections = await getCachedUserPlaylistSections(
        user.id,
        allPlaylists,
        visibilityPrefs
      )

      // Convert sections to app rows format (preserving existing structure)
      appRows = userPlaylistSections.map(section => ({
        id: section.playlistId,
        name: section.label,
        appOrder: section.appOrder
      }))
    }
  } catch (e) {
    console.error('[LandingPage] Failed to load app rows:', e)
    appRows = []
  }

  return (
    <>
      {/* User-configured App Rows (per-user Show in App playlists) with Private Cache */}
      {appRows.length > 0 && appRows.map((p) => (
        <div key={p.id}>
          <h2 className="text-xl font-bold text-left mt-4 ml-4">{p.name}</h2>
          <Suspense>
            <HorizontalScrollContainer type="playlist" playlistId={p.id} user={user} />
          </Suspense>
        </div>
      ))}
    </>
  )
}

export default async function LandingPage({
  user = { id: null, name: '', email: '', limitedAccess: false },
  calendarConfig = { hasAnyCalendar: false },
}) {
  const { id, name, email, limitedAccess } = user

  /* if (limitedAccess) {
    redirect('/list/movie/Big Buck Bunny')
  } */
  
  return (
    <div className="flex min-h-screen flex-col items-center justify-between xl:py-24">
      <Suspense>
        <SyncClientWithServerWatched />
      </Suspense>
      <WelcomeSection userName={name} />
      <div className="flex flex-col w-full mt-10">
        {/* User-dependent sections (Watch History) */}
        <Suspense>
          <UserDependentSections user={user} />
        </Suspense>
        
        {/* User-specific content wrapped in Suspense for partial prerendering */}
        <Suspense>
          <UserSpecificSections user={user} />
        </Suspense>
        
        {/* <RecommendationSectionTitle />*/}
        {/* <h2 className="text-xl font-bold text-left mt-4 ml-4">Recommendations</h2>
        <HorizontalScrollContainer type="recommendations" />  */}
        
        {/* Static media sections (can be prerendered) */}
        <StaticMediaSections />
        
        {/* Calendar section (client component, cannot be cached) */}
        <CalendarSection calendarConfig={calendarConfig} />
      </div>
    </div>
  )
}
