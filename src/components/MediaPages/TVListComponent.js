import clientPromise from '../../lib/mongodb'
import PageContentAnimatePresence from '@components/HOC/PageContentAnimatePresence'
import Link from 'next/link'
import { auth } from '../../lib/auth'
import UnauthenticatedPage from '@components/system/UnauthenticatedPage'
import SignOutButton from '@components/SignOutButton'
import SkeletonCard from '@components/SkeletonCard'
import Detailed from '@components/Poster/Detailed'
import SyncClientWithServerWatched from '@components/SyncClientWithServerWatched'
import { Suspense } from 'react'
import Loading from 'src/app/loading'
import { fetchMetadata } from 'src/utils/admin_utils'
import { getAvailableMedia } from 'src/utils/database'
export const dynamic = 'force-dynamic'

const variants = {
  hidden: { opacity: 0, x: 0, y: -20 },
  enter: { opacity: 1, x: 0, y: 0 },
}
const variants_height = {
  hidden: { opacity: 0 },
  enter: { opacity: 1 },
}

export default async function TVListComponent() {
  const session = await auth()
  if (!session || !session.user) {
    // Handle the case where the user is not authenticated
    // For example, redirect to login or show an error message
    return (
      <UnauthenticatedPage callbackUrl={`/list/tv`}>
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
  const { tvprogramsCount } = await getAvailableMedia({ type: 'tv' })
  return (
    <div className="flex min-h-screen flex-col items-center justify-between xl:p-24">
      <SyncClientWithServerWatched />
      <div className="h-auto flex items-center justify-center py-32 lg:py-0 px-4 xl:px-0 sm:mt-20">
        <ul className="grid grid-cols-1 gap-x-4 gap-y-8 sm:gap-x-6 sm:grid-cols-2 xl:grid-cols-4 xl:gap-x-8">
          <Suspense fallback={<Loading />}>
            <li>
              <h2 className="mx-auto max-w-2xl text-2xl font-bold tracking-tight text-white sm:text-3xl pb-8 xl:pb-0 px-4 xl:px-0">
                ({tvprogramsCount}) Available TV Programs
              </h2>
              <div className="flex flex-row gap-x-4 mt-4 justify-center">
                <Link href="/list" className="self-center">
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
            <Suspense
              fallback={
                <>
                  {Array.from({ length: tvprogramsCount }, (_, i) => (
                    <li key={i + '-skeleton'} className="relative min-w-[250px]">
                      <SkeletonCard key={i} heightClass={'h-[582px]'} />
                    </li>
                  ))}
                </>
              }
            >
              <TVList />
            </Suspense>
          </Suspense>
        </ul>
      </div>
    </div>
  )
}

async function TVList() {
  const tvList = await getAndUpdateMongoDB()
  return (
    <>
      {tvList.map(function (tv, index) {
        return (
          <li key={tv.title} className="relative min-w-[250px]">
            <PageContentAnimatePresence
              _key={tv.title + '-AnimationCont'}
              variants={variants}
              transition={{
                type: 'linear',
                duration: 0.45,
              }}
            >
              <Link href={`/list/tv/${encodeURIComponent(tv.title)}`} className="group">
                <Detailed tvShow={tv} />
              </Link>
            </PageContentAnimatePresence>
          </li>
        )
      })}
    </>
  )
}

async function getAndUpdateMongoDB() {
  const client = await clientPromise
  const tvprograms = await client
    .db('Media')
    .collection('TV')
    .find(
      {},
      {
        projection: {
          _id: 1,
          title: 1,
          metadata: 1,
          posterURL: 1,
          posterBlurhash: 1,
          'seasons.seasonNumber': 1,
          'seasons.title': 1,
          'seasons.season_poster': 1,
          'seasons.seasonPosterBlurhash': 1,
          'seasons.metadata.Genre': 1,
        },
      }
    )
    .sort({ title: 1 })
    .toArray()

  // const updatedTVShows = await client
  //   .db('Media')
  //   .collection('TV')
  //   .find({})
  //   .sort({ _id: -1 })
  //   .toArray()

  tvprograms.sort((a, b) => {
    const dateA = new Date(a.metadata?.last_air_date)
    const dateB = new Date(b.metadata?.last_air_date)

    // Sorting in descending order
    return dateB - dateA
  })

  // Convert MongoDB objects to plain JavaScript objects
  const plainTVShows = await Promise.all(
    tvprograms.map(async (tv) => {
      if (tv.posterBlurhash) {
        tv.posterBlurhash = await fetchMetadata(tv.posterBlurhash, 'blurhash')
      }
      return {
        _id: tv._id.toString(), // Convert ObjectId to string
        title: tv.title,
        metadata: tv.metadata,
        seasons: tv.seasons, // Include the seasons
        backdrop: tv.backdrop,
        posterURL: tv.posterURL,
        posterBlurhash: tv.posterBlurhash,
      }
    })
  )

  return plainTVShows
}
