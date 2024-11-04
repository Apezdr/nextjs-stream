import { Suspense, lazy } from 'react'
import Loading from '@src/app/loading'
import SyncClientWithServerWatched from './SyncClientWithServerWatched'

const HorizontalScrollContainerShell = lazy(() => import('./HorizontalScrollContainerShell'))
const ReleaseCalendar = lazy(() => import('./Calendar/ReleaseCalendar'))
const HorizontalScrollContainer = lazy(
  () => import('@components/MediaScroll/HorizontalScrollContainer')
)

export default function LandingPage({
  user = { name: '', email: '', limitedAccess: false },
  moviesCount,
  tvprogramsCount,
  recentlyaddedCount,
  recentlywatchedCount,
}) {
  const { name, email, limitedAccess } = user
  /* if (limitedAccess) {
    redirect('/list/movie/Big Buck Bunny')
  } */
  return (
    <>
      <div className="flex min-h-screen flex-col items-center justify-between xl:py-24">
        <SyncClientWithServerWatched />
        <div className="h-auto flex pt-12 lg:py-0 px-4 xl:px-0 z-10 relative">
          <ul className="grid grid-cols-1 sm:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8 sm:gap-x-6 xl:gap-x-8">
            <li className="col-span-1 sm:col-span-2">
              <h2 className="max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl pb-8 xl:pb-0 px-4 xl:px-0 self-baseline">
                Welcome {name.split(' ')[0]},
              </h2>
              <h2 className="text-xl font-bold tracking-tight text-white pb-8 xl:pb-0 px-4 xl:px-0">
                <Suspense fallback={<Loading />}>({moviesCount + tvprogramsCount})</Suspense>{' '}
                Available TV Shows & Movies
              </h2>
            </li>
          </ul>
        </div>
        <div className="flex flex-col w-full mt-10">
          <h2 className="text-xl font-bold text-left mt-4 ml-4">Watch History</h2>
          <Suspense
            fallback={<HorizontalScrollContainerShell skeletonCount={recentlywatchedCount} />}
          >
            <HorizontalScrollContainer type="recentlyWatched" />
          </Suspense>
          <h2 className="text-xl font-bold text-left mt-4 ml-4">Recently Added</h2>
          <Suspense
            fallback={<HorizontalScrollContainerShell skeletonCount={recentlyaddedCount} />}
          >
            <HorizontalScrollContainer type="recentlyAdded" />
          </Suspense>
          <h2 className="text-xl font-bold text-left mt-4 ml-4">Movies</h2>
          <Suspense fallback={<HorizontalScrollContainerShell skeletonCount={moviesCount} />}>
            <HorizontalScrollContainer type="movie" sort="id" sortOrder="asc" />
          </Suspense>
          <h2 className="text-xl font-bold text-left mt-4 ml-4">TV</h2>
          <Suspense fallback={<HorizontalScrollContainerShell skeletonCount={tvprogramsCount} />}>
            <HorizontalScrollContainer type="tv" sort="id" sortOrder="asc" />
          </Suspense>
          <Suspense>
            <ReleaseCalendar />
          </Suspense>
        </div>
      </div>
    </>
  )
}
