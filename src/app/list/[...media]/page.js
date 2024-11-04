import MediaPlayerComponent from '@components/MediaPlayer/MediaPlayer'
import MovieListComponent from '@components/MediaPages/MovieListComponent'
import TVListComponent from '@components/MediaPages/TVListComponent'
import { auth } from '../../../lib/auth'
import UnauthenticatedPage from '@components/system/UnauthenticatedPage'
import Link from 'next/link'
import SkeletonCard from '@components/SkeletonCard'
import { getRequestedMedia, getRequestedMediaTrailer } from '../../../utils/database'
import TVEpisodesListComponent from '../../../components/MediaPages/TVEpisodesListComponent'
import TVShowSeasonsList from '../../../components/MediaPages/TVShowSeasonsListComponent'
import { withApprovedUser } from '@components/HOC/ApprovedUser'
import Image from 'next/image'
import { Suspense } from 'react'
import Loading from '@src/app/loading'
import SyncClientWithServerWatched from '@components/SyncClientWithServerWatched'
import { buildURL } from '@src/utils'
import { fileServerURLWithPrefixPath } from '@src/utils/config'

async function validateVideoURL(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' })
    return response.ok
  } catch (error) {
    return false
  }
}

export async function generateMetadata({ params, searchParams }, parent) {
  // read route params
  const mediaType = params?.media?.[0] // 'movie' or 'tv'
  const mediaTitle = params?.media?.[1]
  const mediaSeason = params?.media?.[2] // Could be 'Season X'
  const mediaEpisode = params?.media?.[3] // Could be 'Episode Y'

  let media,
    overview,
    title = (await parent).title.absolute,
    poster = fileServerURLWithPrefixPath + `/poster_collage.jpg`
  if (mediaType === 'tv') {
    media = await getRequestedMedia({
      type: mediaType,
      title: decodeURIComponent(mediaTitle),
      season: mediaSeason,
      episode: mediaEpisode,
    })
    overview = (await parent).description
    if (mediaTitle) {
      title = media?.title ?? title
      overview = media?.metadata?.overview
        ? media.metadata.overview
        : media?.metadata?.tvOverview
          ? media.metadata.tvOverview
          : overview
      poster = media?.posterURL
        ? media.posterURL
        : media?.metadata?.poster_path
          ? `https://image.tmdb.org/t/p/w780${media?.metadata?.poster_path}`
          : buildURL(`/sorry-image-not-available.jpg`)
    }
    if (mediaSeason) {
      title = `${title} - S${mediaSeason.padStart(2, '0')}`
      if (mediaEpisode) {
        title = `${title}E${mediaEpisode.padStart(2, '0')}`
      }
    }
  } else if (mediaType === 'movie') {
    overview = (await parent).description
    if (mediaTitle) {
      media = await getRequestedMedia({
        type: mediaType,
        title: decodeURIComponent(mediaTitle),
      })
      title = media?.title ?? title
      overview = media?.metadata?.overview ?? overview
      poster = media?.posterURL ?? poster
    }
  }

  // optionally access and extend (rather than replace) parent metadata
  // const previousImages = (await parent).openGraph?.images || []
  return {
    title: `${title}`,
    description: `${overview}`,
    openGraph: {
      images: [poster, []],
    },
  }
}

async function MediaPage({ params, searchParams }) {
  const session = await auth()
  let mediaType = params?.media?.[0], // 'movie' or 'tv'
    mediaTitle = params?.media?.[1],
    mediaSeason = params?.media?.[2], // Could be 'Season X'
    mediaEpisode = params?.media?.[3], // Could be 'Episode Y'
    limitedAccess = session && session.user.limitedAccess,
    media

  // Handle if the user is limited and show the video for them
  if (limitedAccess) {
    /* mediaTitle = 'Big Buck Bunny'
    mediaType = 'movie'
    mediaSeason = undefined
    mediaEpisode = undefined */
    if (mediaType === 'tv' && mediaTitle) {
      // Get the trailer for the tv show
      media = await getRequestedMediaTrailer(mediaType, decodeURIComponent(mediaTitle))
    } else if (mediaType === 'movie' && mediaTitle) {
      // Get the trailer for the movie
      media = await getRequestedMediaTrailer(mediaType, decodeURIComponent(mediaTitle))
    }
  } else if (mediaType === 'tv' && mediaTitle) {
    media = await getRequestedMedia({
      type: mediaType,
      title: decodeURIComponent(mediaTitle),
      season: mediaSeason,
      episode: mediaEpisode,
    })
  } else if (mediaType === 'movie' && mediaTitle) {
    media = await getRequestedMedia({
      type: mediaType,
      title: decodeURIComponent(mediaTitle),
    })
  }

  let TVParams = ''
  let MovieParams = ''
  if (mediaType === 'tv') {
    if (mediaTitle) {
      const season = mediaSeason ? '/' + mediaSeason : ''
      TVParams = `/${mediaTitle}${season}`
    }
  }

  // Handle the case where the user is not authenticated
  if (!session || !session.user) {
    if (mediaType === 'tv' && mediaEpisode) {
      TVParams = `${TVParams}/${mediaEpisode}`
    }
    if (mediaType === 'movie' && mediaTitle) {
      MovieParams = `${MovieParams}/${mediaTitle}`
    }
    return (
      <UnauthenticatedPage
        callbackUrl={
          mediaType ? `/list${mediaType ? '/' + mediaType : ''}${TVParams}${MovieParams}` : '/list'
        }
      >
        {media ? (
          <>
            <div className="mt-8 w-full">
              {media.posterURL || media.metadata?.poster_path ? (
                <Image
                  src={
                    media.posterURL
                      ? media.posterURL
                      : `https://image.tmdb.org/t/p/w780${media.metadata.poster_path}`
                  }
                  width={600}
                  height={600}
                  quality={100}
                  alt={media.title}
                  className="max-w-xs w-full h-auto md:w-3/4 mx-auto rounded-lg"
                />
              ) : null}
            </div>
            <h2 className="text-center text-lg text-white mt-2">
              Watch this and more by signing in.
            </h2>
          </>
        ) : mediaTitle && !media ? (
          <>
            <img
              src={'/sorry-image-not-available.jpg'}
              alt="Not found"
              className="w-3/5 h-auto mx-auto rounded-lg"
            />
            <h2 className="text-center text-lg text-white mt-2">
              We couldn&apos;t find that one, but sign in and check out what we have.
            </h2>
          </>
        ) : (
          <>
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
          </>
        )}
      </UnauthenticatedPage>
    )
  }

  if (mediaType === 'tv' && mediaTitle && !mediaSeason) {
    // TV show is selected, but no specific season or episode
    return (
      <Suspense fallback={<Loading />}>
        <TVShowSeasonsList showTitle={mediaTitle} />
      </Suspense>
    )
  } else if (mediaType === 'tv' && mediaTitle && mediaSeason && !mediaEpisode) {
    // Specific season of a TV show is selected, but no episode
    return (
      <Suspense fallback={<Loading />}>
        <TVEpisodesListComponent showTitle={mediaTitle} seasonNumber={mediaSeason} />
      </Suspense>
    )
  } else if (mediaType === 'tv' && mediaTitle && mediaSeason && mediaEpisode) {
    // If a specific episode is selected
    const isValidVideoURL = media.videoURL && (await validateVideoURL(media.videoURL))
    if (media) {
      return (
        <div className="flex flex-col items-center justify-center md:py-12 h-screen max-h-[90%]">
          <SyncClientWithServerWatched once={true} />
          <Suspense fallback={<Loading />}>
            <MediaPlayerComponent
              media={media}
              mediaTitle={mediaTitle}
              mediaType={mediaType}
              goBack={
                mediaType
                  ? `/list${mediaType ? '/' + mediaType : ''}${TVParams}${MovieParams}`
                  : '/list'
              }
              searchParams={searchParams}
              session={session}
              isValidVideoURL={isValidVideoURL}
            />
          </Suspense>
        </div>
      )
    }
    // Handle episode not found
    // ... Similar to 'Media not found error' logic ...
  } else if (mediaType === 'movie' && mediaTitle && media) {
    const isValidVideoURL = media.videoURL && (await validateVideoURL(media.videoURL))
    return (
      <div className="flex flex-col items-center justify-center md:py-12 h-screen max-h-[90%]">
        <SyncClientWithServerWatched once={true} />
        <Suspense fallback={<Loading />}>
          <MediaPlayerComponent
            media={media}
            mediaTitle={mediaTitle}
            mediaType={mediaType}
            goBack={
              mediaType
                ? `/list${mediaType ? '/' + mediaType : ''}${TVParams}${MovieParams}`
                : '/list'
            }
            searchParams={searchParams}
            session={session}
            isValidVideoURL={isValidVideoURL}
          />
        </Suspense>
      </div>
    )
  }
  // Media not found error
  else if (mediaTitle && !media) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-between xl:p-24">
        <div className="flex flex-col max-w-screen-sm">
          <img
            src={'/sorry-image-not-available.jpg'}
            alt="Not found"
            className="w-3/5 h-auto mx-auto rounded-lg"
          />
          <h2 className="text-center text-lg text-white my-2">
            Oops! It seems like the movie you&apos;re searching for isn&apos;t available in our
            collection. Don&apos;t worry, though — we have a wide array of other fantastic movies
            waiting for you. Take a look at our extensive list and find your next favorite!
          </h2>
          <Link
            href={`/list${mediaType ? '/' + mediaType : ''}`}
            className="mx-auto rounded text-center bg-indigo-600 px-2 py-1 text-base font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-4 h-4 inline mr-1"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
              />
            </svg>
            Go back to the list
          </Link>
        </div>
      </div>
    )
  }
  // Show list of media
  else {
    return mediaType === 'movie' ? (
      <Suspense fallback={<Loading />}>
        <MovieListComponent />
      </Suspense>
    ) : (
      <Suspense fallback={<Loading />}>
        <TVListComponent />
      </Suspense>
    )
  }
}

export default withApprovedUser(MediaPage)
