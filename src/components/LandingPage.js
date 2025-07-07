import { Suspense, lazy } from 'react'
import Loading from '@src/app/loading'
import SyncClientWithServerWatched from './SyncClientWithServerWatched'
import HorizontalScrollContainer from '@src/components/MediaScroll/HorizontalScrollContainer'
import AsyncMediaCounts from './AsyncMediaCounts'
import RecommendationSectionTitle from './RecommendationSectionTitle'

const ReleaseCalendar = lazy(() => import('./Calendar/ReleaseCalendar'))

export default function LandingPage({
  user = { name: '', email: '', limitedAccess: false },
  calendarConfig = { hasAnyCalendar: false },
}) {
  const { name, email, limitedAccess } = user
  /* if (limitedAccess) {
    redirect('/list/movie/Big Buck Bunny')
  } */
  return (
    <div className="flex min-h-screen flex-col items-center justify-between xl:py-24">
      <SyncClientWithServerWatched />
      <div className="h-auto flex pt-12 lg:py-0 px-4 xl:px-0 relative">
        <ul className="grid grid-cols-1 sm:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8 sm:gap-x-6 xl:gap-x-8">
          <li className="col-span-1 sm:col-span-2">
            <h2 className="max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl pb-8 xl:pb-0 px-4 xl:px-0 self-baseline">
              Welcome {name.split(' ')[0]},
            </h2>
            <h2 className="text-xl font-bold tracking-tight text-white pb-8 xl:pb-0 px-4 xl:px-0">
              <Suspense>
                <AsyncMediaCounts suffix={` Available TV Shows & Movies`} showDuration={true} />
              </Suspense>
            </h2>
          </li>
        </ul>
      </div>
      <div className="flex flex-col w-full mt-10">
        <h2 className="text-xl font-bold text-left mt-4 ml-4">Watch History</h2>
        <HorizontalScrollContainer type="recentlyWatched" />
        {/* <RecommendationSectionTitle />*/}
        {/* <h2 className="text-xl font-bold text-left mt-4 ml-4">Recommendations</h2>
        <HorizontalScrollContainer type="recommendations" />  */}
        <h2 className="text-xl font-bold text-left mt-4 ml-4">Recently Added</h2>
        <HorizontalScrollContainer type="recentlyAdded" />
        <h2 className="text-xl font-bold text-left mt-4 ml-4">Movies</h2>
        <HorizontalScrollContainer type="movie" sort="id" sortOrder="asc" />
        <h2 className="text-xl font-bold text-left mt-4 ml-4">TV</h2>
        <HorizontalScrollContainer type="tv" sort="id" sortOrder="asc" />
        {calendarConfig.hasAnyCalendar && (
          <Suspense>
            <ReleaseCalendar calendarConfig={calendarConfig} />
          </Suspense>
        )}
      </div>
    </div>
  )
}
