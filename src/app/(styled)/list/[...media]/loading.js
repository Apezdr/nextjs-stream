'use client'

import { usePathname } from 'next/navigation'
import MediaListGridSkeleton from '@components/MediaPages/MediaListGridSkeleton'
import Loading from '@src/app/loading'

const HEADING_CLASS =
  'mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl pb-8 xl:pb-0 px-4 xl:px-0'

const LIST_LABELS = {
  movie: 'Available Movies',
  tv: 'Available TV Programs',
}

function getListMediaType(pathname) {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length !== 2 || segments[0] !== 'list') return null
  return segments[1] === 'movie' || segments[1] === 'tv' ? segments[1] : null
}

function ListPageSkeleton({ label }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-between xl:p-24 bg-[#060916e8]">
      <div className="h-auto flex items-center justify-center py-32 lg:py-0 px-4 xl:px-0 sm:mt-20">
        <ul className="grid grid-cols-1 gap-x-4 gap-y-8 sm:gap-x-6 sm:grid-cols-2 xl:grid-cols-4 xl:gap-x-8">
          <li>
            <h2 className={HEADING_CLASS}>
              <span className="block text-sm text-gray-100">
                <span className="inline-block h-4 w-48 bg-gray-700 rounded animate-pulse align-middle" />
              </span>
              <span className="inline-block h-8 sm:h-9 w-24 bg-gray-700 rounded animate-pulse align-middle" />{' '}
              {label}
            </h2>
            <div className="flex flex-row gap-x-4 mt-4 justify-center">
              <div className="h-9 w-28 bg-indigo-600/40 rounded animate-pulse" />
            </div>
          </li>
          <MediaListGridSkeleton />
        </ul>
      </div>
    </div>
  )
}

function GenericLoading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#060916e8]">
      <Loading fullscreenClasses={false} padding="p-0" />
    </div>
  )
}

export default function MediaRouteLoading() {
  const pathname = usePathname()
  const mediaType = getListMediaType(pathname)
  return mediaType ? <ListPageSkeleton label={LIST_LABELS[mediaType]} /> : <GenericLoading />
}
