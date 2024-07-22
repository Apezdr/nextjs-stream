import clientPromise from '../../lib/mongodb'
import Link from 'next/link'
import { auth } from '../../lib/auth'
import UnauthenticatedPage from '@components/system/UnauthenticatedPage'
import SkeletonCard from '@components/SkeletonCard'
import MediaPoster from '@components/MediaPoster'
import PageContentAnimatePresence from '@components/HOC/PageContentAnimatePresence'
import SignOutButton from '@components/SignOutButton'
import TVShowThumbnail from '@components/TVShowThumbnail'
import SyncClientWithServerWatched from '@components/SyncClientWithServerWatched'
import { Suspense } from 'react'
import Loading from 'src/app/loading'
import { fetchMetadata } from 'src/utils/admin_utils'
import { CaptionSVG } from '@components/SVGIcons'
import HD4kBanner from '../../../public/4kBanner.png'
import Image from 'next/image'
export const dynamic = 'force-dynamic'

const variants = {
  hidden: { opacity: 0, x: 0, y: -20 },
  enter: { opacity: 1, x: 0, y: 0 },
}

export default async function TVEpisodesListComponent({ showTitle, seasonNumber }) {
  const session = await auth()
  if (!session || !session.user) {
    // Handle the case where the user is not authenticated
    // For example, redirect to login or show an error message
    return (
      <UnauthenticatedPage callbackUrl={`/list/movie/${showTitle}/${seasonNumber}`}>
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
  const tvShow = await getAndUpdateMongoDB(decodeURIComponent(showTitle), parseInt(seasonNumber))

  if (!tvShow) {
    // Handle the case where the TV show is not found
    return (
      <div className="flex min-h-screen flex-col items-center justify-between xl:p-24">
        TV Season Episodes not found
      </div>
    )
  }
  const season = tvShow.seasons.find((s) => s.seasonNumber === parseInt(seasonNumber))
  if (!season) {
    return <div>Season not found</div>
  }
  if (season.seasonPosterBlurhash) {
    season.posterBlurhash = await fetchMetadata(season.seasonPosterBlurhash, 'blurhash')
  }
  return (
    <div className="flex min-h-screen flex-col items-center justify-between xl:p-24">
      <SyncClientWithServerWatched />
      <div className="h-auto flex items-center justify-center py-32 lg:py-0 px-4 xl:px-0 sm:mt-20">
        <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-x-4 gap-y-8 sm:gap-x-6 xl:gap-x-8">
          <Suspense fallback={<Loading />}>
            {/* Summary Poster */}
            <li className="col-span-1 sm:col-span-2 xl:col-span-1 lg:row-span-3 text-center">
              <MediaPoster tv={season} className="max-w-full rounded-lg" contClassName="mx-auto" />
              <h2 className="mx-auto max-w-2xl text-2xl font-bold tracking-tight text-white sm:text-3xl pb-8 xl:pb-0 px-4 xl:px-0">
                Viewing Season {season.seasonNumber}
              </h2>
              <h2 className="mx-auto max-w-2xl text-2xl font-bold tracking-tight text-white sm:text-3xl pb-8 xl:pb-0 px-4 xl:px-0">
                {season.episodes.length} Episodes
              </h2>
              <div className="flex flex-row gap-x-4 mt-4 justify-center">
                <Link href={`/list/tv/${tvShow.title}`} className="self-center">
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
            {/* Episodes List */}
            {await Promise.all(
              season.episodes.map(async (episode, episodeIndex) => {
                const episodeMetadata = season.metadata?.episodes.find(
                  (ep) => ep.episode_number === episode.episodeNumber
                )

                if (episode.thumbnailBlurhash) {
                  episode.thumbnailBlurhash = await fetchMetadata(
                    episode.thumbnailBlurhash,
                    'blurhash'
                  )
                }

                let dims, is4k, is1080p
                if (episode.dimensions) {
                  dims = episode.dimensions?.split('x')
                  is4k = parseInt(dims[0]) >= 3840 || parseInt(dims[1]) >= 2160
                  is1080p = parseInt(dims[0]) >= 1920 || parseInt(dims[1]) >= 1080
                }

                return (
                  <li key={episode.title + '-AnimationCont'} className="relative min-w-[250px]">
                    <PageContentAnimatePresence
                      variants={variants}
                      transition={{
                        type: 'linear',
                        duration: 0.45,
                      }}
                    >
                      <Link
                        href={`/list/tv/${showTitle}/${season.seasonNumber}/${episode.episodeNumber}`}
                      >
                        <div className="group block mb-2 w-full">
                          <div className="flex flex-col">
                            <div className="relative block mx-auto overflow-hidden rounded-lg bg-gray-800 focus-within:ring-2 focus-within:ring-indigo-500 focus-within:ring-offset-2 focus-within:ring-offset-gray-100">
                              <TVShowThumbnail episode={episode} metadata={episodeMetadata} />
                              {episode.dimensions && (
                                <div className="flex bg-gray-900 justify-center content-center flex-wrap pb-[18px] pt-3 text-white transition-opacity duration-700 inset-0 text-xs h-3.5 opacity-75 group-hover:opacity-100 relative z-10">
                                  <div className="select-none bg-transparent text-gray-600 transition-opacity duration-700 text-xs h-4">
                                    {is4k ? (
                                      <Image
                                        src={HD4kBanner}
                                        className="h-4 w-auto"
                                        alt={'4k Banner'}
                                        loading="lazy"
                                        placeholder="blur"
                                      />
                                    ) : is1080p ? (
                                      <span className="text-yellow-500 font-bold">1080p</span>
                                    ) : (
                                      dims[0] + 'p'
                                    )}
                                  </div>
                                </div>
                              )}
                              <div className="inset-0 pt-2 pb-4 text-center rounded-b-lg text-sm font-medium text-gray-200 group-hover:text-gray-300 relative z-10">
                                {episode?.captionURLs ? <CaptionSVG className="mr-1.5" /> : ''}
                                Episode {episode.episodeNumber}: {episode.title}
                              </div>
                            </div>
                          </div>
                        </div>
                      </Link>
                    </PageContentAnimatePresence>
                  </li>
                )
              })
            )}
          </Suspense>
        </ul>
      </div>
    </div>
  )
}

async function getAndUpdateMongoDB(showTitle, seasonNumber) {
  const client = await clientPromise

  // Fetch the specific TV show based on the title
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
          'seasons.title': 1,
          'seasons.season_poster': 1,
          'seasons.seasonPosterBlurhash': 1,
          'seasons.metadata.Genre': 1,
          'seasons.metadata.episodes': 1,
          'seasons.episodes': 1,
        },
      }
    )

  if (!tvShow) {
    // Handle the case where the TV show is not found
    return null
  }

  // Find the index of the season in the array
  const seasonIndex = tvShow.seasons.findIndex((season) => season.seasonNumber === seasonNumber)

  // Check if the season exists in the database
  if (seasonIndex === -1) {
    // Handle the case where the season is not found
    return null
  }

  const returnObject = {
    _id: tvShow._id.toString(), // Convert ObjectId to string
    title: tvShow.title,
    metadata: tvShow.metadata, // Include the show's metadata
    currentSeasonMetadata: tvShow.seasons[seasonIndex].metadata, // Include the metadata for the current season
    seasons: tvShow.seasons, // Include the list of all seasons
  }

  return returnObject
}
