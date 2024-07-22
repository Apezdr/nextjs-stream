import Link from 'next/link'
import { Suspense, lazy } from 'react'
import Loading from 'src/app/loading'
import SyncClientWithServerWatched from './SyncClientWithServerWatched'
import SignOutButton from './SignOutButton'
import SearchInput from './Search/SearchInput'
import ReleaseCalendar from './Calendar/ReleaseCalendar'
import { redirect } from 'next/navigation'
import { adminUserEmails } from 'src/utils/config'
const HorizontalScrollContainer = lazy(
  () => import('@components/MediaScroll/HorizontalScrollContainer')
)

export default function LandingPage({
  user = { name: '', email: '', limitedAccess: false },
  moviesCount,
  tvprogramsCount,
}) {
  const { name, email, limitedAccess } = user
  /* if (limitedAccess) {
    redirect('/list/movie/Big Buck Bunny')
  } */
  return (
    <div className="flex min-h-screen flex-col items-center justify-between xl:p-24">
      <SyncClientWithServerWatched />
      <div className="h-auto flex items-center justify-center py-32 lg:py-0 px-4 xl:px-0 sm:mt-20">
        <ul className="grid grid-cols-1 sm:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8 sm:gap-x-6 xl:gap-x-8">
          <li className="col-span-1 sm:col-span-3 xl:col-span-4">
            <SearchInput />
          </li>
          <li className="col-span-1 xl:col-span-2">
            <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl pb-8 xl:pb-0 px-4 xl:px-0">
              Welcome {name.split(' ')[0]},
            </h2>
            <h2 className="mx-auto max-w-2xl text-xl font-bold tracking-tight text-white pb-8 xl:pb-0 px-4 xl:px-0">
              <Suspense fallback={<Loading />}>({moviesCount + tvprogramsCount})</Suspense>{' '}
              Available TV Shows & Movies
            </h2>
            {adminUserEmails.includes(email) && (
              <Link href="/admin">
                <button
                  type="button"
                  className="bg-indigo-600 hover:bg-indigo-500 focus-visible:outline-indigo-600 rounded px-2 py-1 text-base font-semibold text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 mr-2"
                >
                  Admin
                </button>
              </Link>
            )}
            <SignOutButton
              className="mt-4 bg-gray-600 hover:bg-gray-500 focus-visible:outline-gray-600"
              signoutProps={{ callbackUrl: '/' }}
            />
          </li>
          <li className="text-center">
            <Link href="/list/tv">
              <button className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded inline-flex flex-col items-center w-48">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-6 h-6"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 20.25h12m-7.5-3v3m3-3v3m-10.125-3h17.25c.621 0 1.125-.504 1.125-1.125V4.875c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125z"
                  />
                </svg>
                <span>TV</span>
              </button>
            </Link>
          </li>
          <li className="text-center">
            <Link href="/list/movie">
              <button className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded inline-flex flex-col items-center w-48">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-6 h-6"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-1.5A1.125 1.125 0 0118 18.375M20.625 4.5H3.375m17.25 0c.621 0 1.125.504 1.125 1.125M20.625 4.5h-1.5C18.504 4.5 18 5.004 18 5.625m3.75 0v1.5c0 .621-.504 1.125-1.125 1.125M3.375 4.5c-.621 0-1.125.504-1.125 1.125M3.375 4.5h1.5C5.496 4.5 6 5.004 6 5.625m-3.75 0v1.5c0 .621.504 1.125 1.125 1.125m0 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 8.25 6 7.746 6 7.125v-1.5M4.875 8.25C5.496 8.25 6 8.754 6 9.375v1.5m0-5.25v5.25m0-5.25C6 5.004 6.504 4.5 7.125 4.5h9.75c.621 0 1.125.504 1.125 1.125m1.125 2.625h1.5m-1.5 0A1.125 1.125 0 0118 7.125v-1.5m1.125 2.625c-.621 0-1.125.504-1.125 1.125v1.5m2.625-2.625c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125M18 5.625v5.25M7.125 12h9.75m-9.75 0A1.125 1.125 0 016 10.875M7.125 12C6.504 12 6 12.504 6 13.125m0-2.25C6 11.496 5.496 12 4.875 12M18 10.875c0 .621-.504 1.125-1.125 1.125M18 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m-12 5.25v-5.25m0 5.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125m-12 0v-1.5c0-.621-.504-1.125-1.125-1.125M18 18.375v-5.25m0 5.25v-1.5c0-.621.504-1.125 1.125-1.125M18 13.125v1.5c0 .621.504 1.125 1.125 1.125M18 13.125c0-.621.504-1.125 1.125-1.125M6 13.125v1.5c0 .621-.504 1.125-1.125 1.125M6 13.125C6 12.504 5.496 12 4.875 12m-1.5 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M19.125 12h1.5m0 0c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h1.5m14.25 0h1.5"
                  />
                </svg>
                <span>Movies</span>
              </button>
            </Link>
          </li>
          {/* */}
        </ul>
      </div>
      <div className="flex flex-col w-full">
        <h2 className="text-xl font-bold text-left mt-4">Watch History</h2>
        <Suspense fallback={<Loading fullscreenClasses={false} />}>
          <HorizontalScrollContainer type="recentlyWatched" />
        </Suspense>
        <h2 className="text-xl font-bold text-left mt-4">Movies</h2>
        <Suspense fallback={<Loading fullscreenClasses={false} />}>
          <HorizontalScrollContainer type="movie" sort="id" sortOrder="asc" />
        </Suspense>
        <h2 className="text-xl font-bold text-left mt-4">TV</h2>
        <Suspense fallback={<Loading fullscreenClasses={false} />}>
          <HorizontalScrollContainer type="tv" sort="id" sortOrder="asc" />
        </Suspense>
        <ReleaseCalendar />
      </div>
    </div>
  )
}
