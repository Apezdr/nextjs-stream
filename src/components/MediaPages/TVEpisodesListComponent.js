import { getFlatTVSeasonWithEpisodes } from '@src/utils/flatDatabaseUtils'
import { refreshEpisodes } from '@src/utils/actions/refreshEpisodes'
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
import Loading from '@src/app/loading'
import NoEpisodesFound from './NoEpisodesFound'
import { fetchMetadataMultiServer } from '@src/utils/admin_utils'
import { CaptionSVG } from '@components/SVGIcons'
import HD4kBanner from '../../../public/4kBanner.png'
import hdr10PlusLogo from '../../../public/HDR10+_Logo_light.svg'
import { generateClipVideoURL } from '@src/utils/auth_utils'
import RetryImage from '@components/RetryImage'
import Image from 'next/image'
export const dynamic = 'force-dynamic'

const variants = {
  hidden: { opacity: 0, x: 0, y: -20 },
  enter: { opacity: 1, x: 0, y: 0 },
}

export default async function TVEpisodesListComponent({ showTitle, originalTitle, seasonNumber }) {
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
  
  // Fetch the TV show season with its episodes using the flat database structure
  const season = await getFlatTVSeasonWithEpisodes({
    showTitle: decodeURIComponent(showTitle),
    seasonNumber: parseInt(seasonNumber)
  })

  if (!season) {
    // Handle the case where the TV show or season is not found
    return (
      <div className="flex min-h-screen flex-col items-center justify-between xl:p-24">
        TV Season Episodes not found
      </div>
    )
  }

  // Season metadata
  const seasonMetadata = season?.metadata ?? {
    episodes: [],
  }
  
  // Make sure we have episodes
  if (!season.episodes || season.episodes.length === 0) {
    return (
      <NoEpisodesFound 
        onRetry={refreshEpisodes} 
        showTitle={showTitle} 
        seasonNumber={seasonNumber}
        season={season}
      />
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-between xl:p-24">
      <SyncClientWithServerWatched />
      <div className="h-auto flex items-center justify-center py-32 lg:py-0 px-4 xl:px-0 sm:mt-20">
        <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-x-4 gap-y-8 sm:gap-x-6 xl:gap-x-8">
          <Suspense fallback={<Loading />}>
            {/* Summary Poster */}
            <li className="col-span-1 sm:col-span-2 xl:col-span-1 lg:row-span-3 text-center">
              <MediaPoster
                tv={season}
                className="max-w-full rounded-lg !mx-auto"
                contClassName="mx-auto"
              />
              <h2 className="mx-auto max-w-2xl text-2xl font-bold tracking-tight text-white sm:text-3xl pb-8 xl:pb-0 px-4 xl:px-0">
                Viewing Season {season.seasonNumber}
              </h2>
              <h2 className="mx-auto max-w-2xl text-2xl font-bold tracking-tight text-white sm:text-3xl pb-8 xl:pb-0 px-4 xl:px-0">
                {season.episodes.length} Episodes
              </h2>
              <div className="flex flex-row gap-x-4 justify-center">
                Originally Aired: {seasonMetadata?.airDate
                  ? new Date(seasonMetadata?.airDate).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })
                  : new Date(season?.airDate).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
              </div>
              <div className="mt-2 text-center text-sm font-medium text-gray-300 group-hover:text-white pt-2 border-t border-solid border-t-[#c1c1c133]">
                {seasonMetadata?.overview || season.overview}
              </div>
              {seasonMetadata?.vote_average ? (
                <div className="flex flex-row gap-x-4 mt-4 justify-center items-center">
                  <span className="text-yellow-400 font-bold">Popularity:</span>
                  <div className="relative w-48 h-4 bg-gray-700 rounded-full">
                  <div
                    className="absolute top-0 left-0 h-full bg-yellow-400 rounded-full"
                    style={{ width: `${seasonMetadata?.vote_average * 10}%` }}
                  ></div>
                  </div>
                  <span className="text-white font-bold">{seasonMetadata?.vote_average} / 10</span>
                </div>
                ) : season?.popularity ? (
                <div className="flex flex-row gap-x-4 mt-4 justify-center items-center">
                  <span className="text-yellow-400 font-bold">Popularity:</span>
                  <div className="relative w-48 h-4 bg-gray-700 rounded-full">
                  <div
                    className="absolute top-0 left-0 h-full bg-yellow-400 rounded-full"
                    style={{ width: `${season?.popularity}%` }}
                  ></div>
                  </div>
                  <span className="text-white font-bold">{season?.popularity} / 10</span>
                </div>
              ) : null}
              <div className="flex flex-row gap-x-4 mt-4 justify-center">
                <Link href={`/list/tv/${season.showTitle || showTitle}`} className="self-center">
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
                // Get episode metadata from season metadata if available
                let episodeMetadata = seasonMetadata?.episodes?.find(
                  (ep) => ep?.episode_number === episode?.episodeNumber
                )

                // Fallback to episode metadata if not found
                if (!episodeMetadata) {
                  episodeMetadata = episode.metadata
                }

                let dims, is4k, is1080p
                if (episode.dimensions) {
                  dims = episode.dimensions?.split('x')
                  is4k = parseInt(dims[0]) >= 3840 || parseInt(dims[1]) >= 2160
                  is1080p = parseInt(dims[0]) >= 1920 || parseInt(dims[1]) >= 1080
                }
                
                let hdr
                if (episode.hdr) {
                  hdr = episode.hdr
                }

                // Generate clip video URL if videoURL is available
                if (episode.videoURL && originalTitle) {
                  episode.clipVideoURL = generateClipVideoURL(episode, 'tv', originalTitle)
                }

                const episodeTitle = episodeMetadata?.name ?? episode.title
                const listKey = `episode-${episode.episodeNumber}-${episode._id || episodeIndex}`

                return (
                  <li key={listKey + '-AnimationCont'} className="relative min-w-[250px]">
                    <PageContentAnimatePresence
                      variants={variants}
                      transition={{
                        type: 'linear',
                        duration: 0.45,
                      }}
                      key={listKey}
                    >
                      <Link
                        href={`/list/tv/${showTitle}/${season.seasonNumber}/${episode.episodeNumber}`}
                      >
                        <div className="group block mb-2 w-full">
                          <div className="flex flex-col">
                            <div className="relative block mx-auto overflow-hidden rounded-lg bg-gray-800 focus-within:ring-2 focus-within:ring-indigo-500 focus-within:ring-offset-2 focus-within:ring-offset-gray-100">
                              <TVShowThumbnail episode={episode} metadata={episodeMetadata} />
                              {episode.dimensions && (
                                <div className="flex gap-3 bg-gray-900 justify-center content-center flex-wrap pb-[18px] pt-3 text-white transition-opacity duration-700 inset-0 text-xs h-3.5 opacity-75 group-hover:opacity-100 relative z-10">
                                  <div className="select-none bg-transparent text-gray-600 transition-opacity duration-700 text-xs h-4">
                                    {is4k ? (
                                      <RetryImage
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
                                  {hdr ? (
                                    <div className="select-none bg-transparent text-gray-600 transition-opacity duration-700 text-xs h-4">
                                    {hdr === 'HDR10' ? (
                                    <RetryImage src={hdr10PlusLogo} alt={'HDR10 Logo'} className="h-4 w-auto" loading="lazy" />  
                                    ) : (
                                    <>{hdr}</>
                                    )}
                                  </div>
                                  ) : null}
                                </div>
                              )}
                              <div className="inset-0 pt-2 pb-4 text-center rounded-b-lg text-sm font-medium text-gray-200 group-hover:text-gray-300 relative z-10">
                                {episode?.captionURLs ? <CaptionSVG className="mr-1.5" /> : ''}
                                Episode {episode.episodeNumber}: {episodeTitle}
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
