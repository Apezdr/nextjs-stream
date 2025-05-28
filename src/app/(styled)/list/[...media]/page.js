const dynamic = 'force-dynamic'
import MediaPlayerComponent from '@components/MediaPlayer/MediaPlayer'
import EpisodeListComponent from '@components/MediaPlayer/EpisodeListComponent'
import { PlaybackCoordinatorProvider } from '@src/contexts/PlaybackCoordinatorContext'
import MovieListComponent from '@components/MediaPages/MovieListComponent'
import TVListComponent from '@components/MediaPages/TVListComponent'
import { auth } from '../../../../lib/auth'
import UnauthenticatedPage from '@components/system/UnauthenticatedPage'
import Link from 'next/link'
import SkeletonCard from '@components/SkeletonCard'
import TVEpisodesListComponent from '../../../../components/MediaPages/TVEpisodesListComponent'
import TVShowSeasonsList from '../../../../components/MediaPages/TVShowSeasonsListComponent'
import { withApprovedUser } from '@components/HOC/ApprovedUser'
import Image from 'next/image'
import { Suspense } from 'react'
import Loading from '@src/app/loading'
import SyncClientWithServerWatched from '@components/SyncClientWithServerWatched'
import { fileServerURLWithPrefixPath } from '@src/utils/config'
import RetryImage from '@components/RetryImage'
import MovieDetailsComponent from '@components/MediaPages/MovieDetailsComponent'
import TVEpisodeDetailsComponent from '@components/MediaPages/TVEpisodeDetailsComponent'
import { getFlatRequestedMedia, getTrailerMedia } from '@src/utils/flatDatabaseUtils'

async function validateVideoURL(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' })
    return response.ok
  } catch (error) {
    return false
  }
}

const posterCollage = fileServerURLWithPrefixPath(`/poster_collage.jpg`)

export async function generateMetadata(props, parent) {
  const params = await props.params;
  // read route params
  const mediaType = params?.media?.[0] // 'movie' or 'tv'
  const mediaTitle = params?.media?.[1]
  const mediaSeason = params?.media?.[2] // Could be 'Season X'
  const mediaEpisode = params?.media?.[3] // Could be 'Episode Y'

  let media,
    overview,
    title = (await parent).title.absolute,
    poster = posterCollage
  if (mediaType === 'tv') {
    media = await getFlatRequestedMedia({
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
          : `/sorry-image-not-available.jpg`
    }
    if (mediaSeason) {
      title = `${title} - S${mediaSeason.replace('Season ', '').padStart(2, '0')}`
      if (mediaEpisode) {
        title = `${title}E${mediaEpisode.replace('Episode ', '').padStart(2, '0')}`
      }
    }
  } else if (mediaType === 'movie') {
    overview = (await parent).description
    if (mediaTitle) {
      media = await getFlatRequestedMedia({
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
  const _params = await params
  let mediaType = _params?.media?.[0], // 'movie' or 'tv'
    mediaTitle = _params?.media?.[1],
    mediaOriginalTitle = null,
    mediaSeason = null,
    mediaEpisode = null,
    mediaPlayerPage = null,
    limitedAccess = session && session.user?.limitedAccess,
    media
  if (mediaType == 'tv') {
    mediaSeason = _params?.media?.[2] // Could be 'Season X'
    mediaEpisode = _params?.media?.[3] // Could be 'Episode Y'
    mediaPlayerPage = _params?.media?.[4] === 'play' // ex. /list/tv/Breaking%20Bad/1/1/play
  }
  if (mediaType === 'movie') {
    mediaPlayerPage = _params?.media?.[2] === 'play' // ex. /list/movie/Inception/play
  }
  const _searchParams = await searchParams
  
  // Extract start parameter if it exists
  const startTime = _searchParams.start ? parseInt(_searchParams.start) : null
  
  // Handle if the user is limited and show the video for them
  if (limitedAccess) {
    /* mediaTitle = 'Big Buck Bunny'
    mediaType = 'movie'
    mediaSeason = undefined
    mediaEpisode = undefined */
    if (mediaType === 'tv' && mediaTitle) {
      // Get the trailer for the tv show
      media = await getTrailerMedia(mediaType, mediaTitle);
    } else if (mediaType === 'movie' && mediaTitle) {
      // Get the trailer for the movie
      media = await getTrailerMedia(mediaType, mediaTitle);
    }
  } else if (mediaType === 'tv' && mediaTitle) {
    media = await getFlatRequestedMedia({
      type: mediaType,
      title: decodeURIComponent(mediaTitle),
      season: mediaSeason,
      episode: mediaEpisode,
    })
  } else if (mediaType === 'movie' && mediaTitle) {
    media = await getFlatRequestedMedia({
      type: mediaType,
      title: decodeURIComponent(mediaTitle),
    })
  }

  let TVParams = ''
  let MovieParams = ''
  if (mediaType === 'tv') {
    if (mediaTitle) {
      const season = mediaSeason ? '/' + mediaSeason : ''
      const episode = mediaEpisode ? '/' + mediaEpisode : ''
      TVParams = `/${mediaTitle}${season}${episode}`
    }
  }

  if (media?.originalTitle) {
    mediaOriginalTitle = media.originalTitle
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
                <RetryImage
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
        <TVEpisodesListComponent showTitle={mediaTitle} originalTitle={mediaOriginalTitle} seasonNumber={mediaSeason} />
      </Suspense>
    )
  } else if (mediaType === 'tv' && mediaTitle && mediaSeason && mediaEpisode) {
    // If a specific episode is selected
    const isValidVideoURL = media && media.videoURL && (await validateVideoURL(media.videoURL))
    if (media) {
      return (
        <PlaybackCoordinatorProvider>
          <>
          <div className="flex flex-col items-center justify-center md:py-12 h-screen max-h-[90%]">
            <SyncClientWithServerWatched once={true} />
            <Suspense fallback={<Loading />}>
            {mediaPlayerPage ? (
                <MediaPlayerComponent
                  media={media}
                  mediaTitle={mediaTitle}
                  mediaType={mediaType}
                  goBack={
                    mediaType
                      ? `/list${mediaType ? '/' + mediaType : ''}${TVParams}`
                      : '/list'
                  }
                  searchParams={{..._searchParams, start: startTime}}
                  session={session}
                  isValidVideoURL={isValidVideoURL}
                />
              ) : (
              <Suspense fallback={<Loading />}>
                <div className='max-h-[90%] h-screen pt-16 w-full'>
                <TVEpisodeDetailsComponent media={media} />
                </div>
              </Suspense>
              )}
            </Suspense>
          </div>
          {/* Episode list for easier navigation */}
          {mediaPlayerPage ? (
          <Suspense fallback={<Loading />}>
            <div className="w-full">
              <EpisodeListComponent 
                mediaTitle={decodeURIComponent(mediaTitle)} 
                mediaSeason={mediaSeason} 
                mediaEpisode={mediaEpisode}
              />
            </div>
          </Suspense>
          ) : null}
          </>
        </PlaybackCoordinatorProvider>
      )
    }
    // Handle episode not found
    // ... Similar to 'Media not found error' logic ...
  } else if (mediaType === 'movie' && mediaTitle && media) {
    const isValidVideoURL = media.videoURL && (await validateVideoURL(media.videoURL))
    return (
      <>
      <SyncClientWithServerWatched once={true} />
        {mediaPlayerPage ? (
        // ex. /list/movie/Inception/play
        <Suspense fallback={<Loading />}>
          <PlaybackCoordinatorProvider>
            <div className="flex flex-col items-center justify-center md:py-12 h-screen max-h-[90%]">
              <MediaPlayerComponent
                media={media}
                mediaTitle={mediaTitle}
                mediaType={mediaType}
                goBack={
                  mediaType
                    ? `/list${mediaType ? '/' + mediaType + '/' + mediaTitle : ''}${MovieParams}`
                    : '/list'
                }
                searchParams={{..._searchParams, start: startTime}}
                session={session}
                isValidVideoURL={isValidVideoURL}
              />
            </div>
          </PlaybackCoordinatorProvider>
        </Suspense>
        ) : (
        // ex. /list/movie/Inception
        <Suspense fallback={<Loading />}>
          <div className='max-h-[90%] h-screen pt-16 w-full'>
          <MovieDetailsComponent media={media} />
          </div>
        </Suspense>
        )}
      </>
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
