import clientPromise from '../../lib/mongodb'
import { TotalRuntime } from '@components/watched'
import PageContentAnimatePresence from '@components/HOC/PageContentAnimatePresence'
import Link from 'next/link'
import MediaPoster from '@components/MediaPoster'
import { auth } from '../../lib/auth'
import UnauthenticatedPage from '@components/system/UnauthenticatedPage'
import SignOutButton from '@components/SignOutButton'
import SkeletonCard from '@components/SkeletonCard'
import { CaptionSVG, GoogleCloudSVG } from '@components/SVGIcons'
import SyncClientWithServerWatched from '@components/SyncClientWithServerWatched'
import { cache, Suspense } from 'react'
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

async function getLastUpdatedTimestamp() {
  const client = await clientPromise
  const lastUpdatedDoc = await client
    .db('Media')
    .collection('MediaUpdatesMovies')
    .find({})
    .sort({ _id: -1 })
    .limit(1)
    .toArray()

  return lastUpdatedDoc[0]?.lastUpdated || new Date().toISOString()
}

export default async function MovieListComponent() {
  const session = await auth()
  if (!session || !session.user) {
    // Handle the case where the user is not authenticated
    // For example, redirect to login or show an error message
    return (
      <UnauthenticatedPage callbackUrl={'/list/movie'}>
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
  const { moviesCount } = await getAvailableMedia({ type: 'movie' })
  return (
    <div className="flex min-h-screen flex-col items-center justify-between xl:p-24">
      <SyncClientWithServerWatched />
      <div className="h-auto flex items-center justify-center py-32 lg:py-0 px-4 xl:px-0 sm:mt-20">
        <ul className="grid grid-cols-1 gap-x-4 gap-y-8 sm:gap-x-6 sm:grid-cols-2 xl:grid-cols-4 xl:gap-x-8">
          <li>
            <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl pb-8 xl:pb-0 px-4 xl:px-0">
              <Suspense fallback={<Loading />}>({moviesCount})</Suspense> Available Movies
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
                {Array.from({ length: moviesCount }, (_, i) => (
                  <li key={i + '-skeleton'} className="relative min-w-[250px]">
                    <SkeletonCard key={i} heightClass={'h-[582px]'} />
                  </li>
                ))}
              </>
            }
          >
            <MovieList />
          </Suspense>
        </ul>
      </div>
    </div>
  )
}

async function MovieList() {
  const latestUpdateTimestamp = await getLastUpdatedTimestamp()
  const movieList = await getAndUpdateMongoDB(latestUpdateTimestamp)
  return (
    <>
      {movieList.map((movie, index) => (
        <li key={movie.title} className="relative min-w-[250px]">
          <PageContentAnimatePresence
            _key={movie.title + '-AnimationCont'}
            variants={variants}
            transition={{
              type: 'linear',
              duration: 0.45,
            }}
          >
            <Link href={`movie/${encodeURIComponent(movie.title)}`} className="group">
              <div className="relative block w-max mx-auto overflow-hidden rounded-lg bg-gray-100 focus-within:ring-2 focus-within:ring-indigo-500 focus-within:ring-offset-2 focus-within:ring-offset-gray-100">
                <MediaPoster movie={movie} />
                <button type="button" className="absolute inset-0 focus:outline-none">
                  <span className="sr-only">View details for {movie.title}</span>
                </button>
              </div>
              <PageContentAnimatePresence
                _key={index + '-Metadata1'}
                variants={variants_height}
                transition={{ type: 'linear', delay: 0.8, duration: 2 }}
              >
                <p className="pointer-events-none mt-2 block text-sm font-medium text-gray-200 text-center">
                  <TotalRuntime
                    length={movie.length ?? movie.metadata.runtime * 60000 ?? 0}
                    metadata={movie.metadata}
                    videoURL={movie.videoURL}
                  />
                </p>
              </PageContentAnimatePresence>
              <PageContentAnimatePresence
                _key={index + '-Metadata2'}
                variants={variants_height}
                transition={{ type: 'linear', delay: 0.81, duration: 2 }}
              >
                <p className="pointer-events-none mt-2 block text-sm font-medium text-gray-200 text-center">
                  {movie.metadata.release_date}
                </p>
              </PageContentAnimatePresence>
              <PageContentAnimatePresence
                _key={index + '-Metadata3'}
                variants={variants_height}
                transition={{ type: 'linear', delay: 1.15, duration: 2 }}
              >
                <span className="pointer-events-none mt-2 block truncate text-sm font-medium text-white">
                  <span className="underline">{movie.title}</span>{' '}
                  {movie?.captionURLs ? <CaptionSVG /> : ''}
                </span>
              </PageContentAnimatePresence>
              <PageContentAnimatePresence
                _key={index + '-Metadata4'}
                variants={variants_height}
                transition={{ type: 'linear', delay: 1.15, duration: 2 }}
              >
                <p className="pointer-events-none mt-2 block text-sm font-medium text-gray-100">
                  {movie.metadata.overview}
                </p>
              </PageContentAnimatePresence>
            </Link>
          </PageContentAnimatePresence>
        </li>
      ))}
    </>
  )
}

const getAndUpdateMongoDB = cache(async () => {
  const client = await clientPromise

  const movies = await client
    .db('Media')
    .collection('Movies')
    .find(
      {},
      {
        projection: {
          title: 1,
          posterURL: 1,
          posterBlurhash: 1,
          videoURL: 1,
          length: 1,
          dimensions: 1,
          captionURLs: 1,
          'metadata.genres': 1,
          'metadata.overview': 1,
          'metadata.release_date': 1,
          'metadata.runtime': 1,
        },
      }
    )
    .sort({ title: 1 })
    .toArray()
  movies.sort((a, b) => {
    const dateA = a.metadata?.release_date
    const dateB = b.metadata?.release_date

    // Sorting in descending order
    return dateB - dateA
  })

  // Convert MongoDB objects to plain JavaScript objects
  const plainMovies = await Promise.all(
    movies.map(async (movie) => {
      const returnObject = {
        _id: movie._id.toString(), // Convert ObjectId to string
        title: movie.title,
        videoURL: movie.videoURL,
        metadata: movie.metadata,
        dimensions: movie.dimensions,
        length: movie.length,
      }
      if (movie.metadata.release_date) {
        returnObject.metadata.release_date = movie.metadata.release_date.toLocaleDateString()
      }
      if (movie.metadata.runtime <= 0) {
        returnObject.metadata.runtime = movie.length
      }

      if (movie.captionURLs) {
        returnObject.captionURLs = movie.captionURLs
      }

      if (movie.posterURL) {
        returnObject.posterURL = movie.posterURL
      }

      if (movie.posterBlurhash) {
        returnObject.posterBlurhash = await fetchMetadata(movie.posterBlurhash, 'blurhash')
      }

      return returnObject
    })
  )

  return plainMovies
})
