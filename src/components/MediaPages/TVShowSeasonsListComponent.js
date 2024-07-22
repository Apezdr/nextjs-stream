import clientPromise from '../../lib/mongodb'
import Link from 'next/link'
import { auth } from '../../lib/auth'
import UnauthenticatedPage from '@components/system/UnauthenticatedPage'
import SkeletonCard from '@components/SkeletonCard'
import PageContentAnimatePresence from '@components/HOC/PageContentAnimatePresence'
import SignOutButton from '@components/SignOutButton'
import MediaPoster from '../MediaPoster'
import Detailed from '@components/Poster/Detailed'
import SyncClientWithServerWatched from '@components/SyncClientWithServerWatched'
import { fetchMetadata } from 'src/utils/admin_utils'
export const dynamic = 'force-dynamic'

const variants = {
  hidden: { opacity: 0, x: 0, y: -20 },
  enter: { opacity: 1, x: 0, y: 0 },
}

export default async function TVShowSeasonsList({ showTitle }) {
  const session = await auth()
  if (!session || !session.user) {
    // Handle the case where the user is not authenticated
    // For example, redirect to login or show an error message
    return (
      <UnauthenticatedPage callbackUrl={`/list/tv/${showTitle}`}>
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
    user: { name, email },
  } = session
  // Fetch the TV show and its seasons
  const tvShow = await getAndUpdateMongoDB(decodeURIComponent(showTitle))

  if (!tvShow) {
    // Handle the case where the TV show is not found
    return (
      <div className="flex min-h-screen flex-col items-center justify-between xl:p-24">
        <div>
          <SkeletonCard />
          <h2 className="text-center mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl pb-8 xl:pb-0 px-4 xl:px-0 mt-4">
            `{decodeURIComponent(showTitle)}`
          </h2>
          <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl pb-8 xl:pb-0 px-4 xl:px-0 mt-4">
            We don't have that one
          </h2>
          <div className="flex flex-row gap-x-4 mt-4 justify-center">
            <Link href="/list/tv" className="self-center">
              <button
                type="button"
                className="flex flex-row gap-x-2 rounded bg-indigo-600 px-2 py-1 text-base font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              >
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
                    d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
                  />
                </svg>
                Go Back
              </button>
            </Link>
          </div>
        </div>
      </div>
    )
  }
  if (tvShow.posterBlurhash) {
    tvShow.posterBlurhash = await fetchMetadata(tvShow.posterBlurhash, 'blurhash')
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-between xl:p-24">
      <SyncClientWithServerWatched />
      <ul className="grid grid-cols-1 gap-x-4 gap-y-8 sm:gap-x-6 sm:grid-cols-3 xl:grid-cols-6 xl:gap-x-2">
        {/* Summary Poster */}
        <li className="col-span-1 sm:col-span-3 xl:col-span-2 lg:row-span-3">
          <Detailed tvShow={tvShow} />
          <div className="flex flex-row gap-x-4 mt-4 justify-center">
            <Link href="/list/tv" className="self-center">
              <button
                type="button"
                className="flex flex-row gap-x-2 rounded bg-indigo-600 px-2 py-1 text-base font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              >
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
                    d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
                  />
                </svg>
                Go Back
              </button>
            </Link>
            <SignOutButton
              className="self-center bg-gray-600 hover:bg-gray-500 focus-visible:outline-gray-600"
              signoutProps={{ callbackUrl: '/' }}
            />
          </div>
        </li>
        {/* Seasons List */}
        {await Promise.all(
          tvShow.seasons.map(async (season, seasonIndex) => {
            if (season.seasonPosterBlurhash) {
              season.posterBlurhash = await fetchMetadata(season.seasonPosterBlurhash, 'blurhash')
            }
            return (
              <li
                key={season.seasonNumber + '-AnimationCont'}
                className="relative min-w-[250px] ml-4 xl:ml-0"
              >
                <PageContentAnimatePresence
                  variants={variants}
                  transition={{
                    type: 'linear',
                    duration: 0.45,
                  }}
                >
                  <Link href={`/list/tv/${showTitle}/${season.seasonNumber}`}>
                    <div className="block mb-2 w-full lg:w-auto group">
                      <MediaPoster className="max-w-[200px]" tv={season} />
                      <button
                        type="button"
                        className="w-full flex flex-row gap-x-2 justify-center rounded bg-indigo-600 px-2 py-1 text-base font-semibold text-white shadow-sm group-hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 h-16 lg:h-auto max-w-[200px]"
                      >
                        <div className="mt-2 text-center text-sm font-medium text-gray-200">
                          <span className="underline">Season {season.seasonNumber}</span>
                        </div>
                      </button>
                    </div>
                  </Link>
                </PageContentAnimatePresence>
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}

async function getAndUpdateMongoDB(showTitle) {
  const client = await clientPromise
  // Use projection to only fetch necessary fields
  // Explicitly include necessary fields and exclude seasons.episodes
  const tvShow = await client
    .db('Media')
    .collection('TV')
    .findOne(
      { title: showTitle },
      {
        projection: {
          title: 1,
          metadata: 1,
          posterURL: 1,
          posterBlurhash: 1,
          'seasons.seasonNumber': 1,
          //'seasons.episodes': 1,
          'seasons.title': 1,
          'seasons.season_poster': 1,
          'seasons.seasonPosterBlurhash': 1,
          'seasons.metadata.Genre': 1,
        },
      }
    )

  if (!tvShow) {
    return null
  }

  return {
    _id: tvShow._id.toString(),
    title: tvShow.title,
    metadata: tvShow.metadata,
    seasons: tvShow.seasons,
    posterURL: tvShow.posterURL,
    posterBlurhash: tvShow.posterBlurhash,
  }
}
