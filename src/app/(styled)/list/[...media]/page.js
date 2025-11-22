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
import { redirect } from 'next/navigation'
import PosterFan from '@components/MediaPages/not-found/PosterFan'

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
  const params = await props.params
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

    // Handle redirect if TV show was found via originalTitle
    if (media && media.foundByOriginalTitle) {
      // Build the canonical URL using the actual title
      const canonicalTitle = encodeURIComponent(media.title)
      let redirectUrl = `/list/tv/${canonicalTitle}`

      // Preserve season and episode parameters in the redirect
      if (mediaSeason) {
        redirectUrl += `/${mediaSeason}`
        if (mediaEpisode) {
          redirectUrl += `/${mediaEpisode}`
        }
      }

      // Log the redirect for debugging
      if (Boolean(process.env.DEBUG) == true) {
        console.log(
          `[REDIRECT] TV show found via originalTitle in generateMetadata. Redirecting from "${decodeURIComponent(mediaTitle)}" to "${media.title}" at ${redirectUrl}`
        )
      }

      // Perform server-side redirect (HTTP 301 for SEO)
      redirect(redirectUrl)
    }

    overview = (await parent).description
    if (mediaTitle) {
      title = media?.title ?? title
      overview = media?.metadata?.overview
        ? media.metadata.overview
        : media?.metadata?.tvOverview
          ? media.metadata.tvOverview
          : overview
      
      // For TV episodes, prioritize episode thumbnail over season/show poster
      if (mediaEpisode && media?.thumbnail) {
        title = `${media?.showTitle} - ${title}` // Include show title for episodes
        poster = media.thumbnail
      } else {
        poster = media?.posterURL
          ? media.posterURL
          : media?.metadata?.poster_path
            ? `https://image.tmdb.org/t/p/w780${media?.metadata?.poster_path}`
            : `/sorry-image-not-available.jpg`
      }
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
    media,
    mediaNotFoundType = null // Track what level failed for better error handling
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
      media = await getTrailerMedia(mediaType, mediaTitle)
    } else if (mediaType === 'movie' && mediaTitle) {
      // Get the trailer for the movie
      media = await getTrailerMedia(mediaType, mediaTitle)
    }
  } else if (mediaType === 'tv' && mediaTitle) {
    // Hierarchical checking for TV shows
    // First, check if the show exists (base level)
    const baseShow = await getFlatRequestedMedia({
      type: mediaType,
      title: decodeURIComponent(mediaTitle),
    })

    if (!baseShow) {
      // Show not found - set error type and skip further checking
      mediaNotFoundType = 'show'
      media = null
    } else {
      // Show exists, handle redirect if found via originalTitle
      if (baseShow.foundByOriginalTitle) {
        // Build the canonical URL using the actual title
        const canonicalTitle = encodeURIComponent(baseShow.title)
        let redirectUrl = `/list/tv/${canonicalTitle}`

        // Preserve season and episode parameters in the redirect
        if (mediaSeason) {
          redirectUrl += `/${mediaSeason}`
          if (mediaEpisode) {
            redirectUrl += `/${mediaEpisode}`
          }
          if (mediaPlayerPage) {
            redirectUrl += '/play'
          }
        }

        // Log the redirect for debugging
        if (Boolean(process.env.DEBUG) == true) {
          console.log(
            `[REDIRECT] TV show found via originalTitle. Redirecting from "${decodeURIComponent(mediaTitle)}" to "${baseShow.title}" at ${redirectUrl}`
          )
        }

        // Perform server-side redirect (HTTP 301 for SEO)
        redirect(redirectUrl)
      }

      // Show found, now check if season/episode are requested
      if (mediaSeason || mediaEpisode) {
        // Get the requested season/episode
        media = await getFlatRequestedMedia({
          type: mediaType,
          title: decodeURIComponent(mediaTitle),
          season: mediaSeason,
          episode: mediaEpisode,
        })

        if (!media) {
          // Determine what level failed
          if (mediaSeason && !mediaEpisode) {
            mediaNotFoundType = 'season'
          } else if (mediaSeason && mediaEpisode) {
            // Check if season exists but episode doesn't
            const seasonOnly = await getFlatRequestedMedia({
              type: mediaType,
              title: decodeURIComponent(mediaTitle),
              season: mediaSeason,
            })
            mediaNotFoundType = seasonOnly ? 'episode' : 'season'
          }
        }
      } else {
        // No season/episode requested, use the base show
        media = baseShow
      }
    }
  } else if (mediaType === 'movie' && mediaTitle) {
    media = await getFlatRequestedMedia({
      type: mediaType,
      title: decodeURIComponent(mediaTitle),
    })

    if (!media) {
      mediaNotFoundType = 'movie'
    }
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
        <div className="flex flex-col items-center justify-between">
          <div className="flex flex-col max-w-screen-sm">
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
                <Image
                  src={'/sorry-image-not-available.jpg'}
                  alt="Not found"
                  width={400}
                  height={400}
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
          </div>
        </div>
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
  } else if (mediaType === 'tv' && media && mediaTitle && mediaSeason && !mediaEpisode) {
    // Specific season of a TV show is selected, but no episode
    return (
      <Suspense fallback={<Loading />}>
        <TVEpisodesListComponent
          showTitle={mediaTitle}
          originalTitle={mediaOriginalTitle}
          seasonNumber={mediaSeason}
        />
      </Suspense>
    )
  } else if (mediaType === 'tv' && media && mediaTitle && mediaSeason && mediaEpisode) {
    // If a specific episode is selected
    const isValidVideoURL = media
      ? media.videoURL && (await validateVideoURL(media.videoURL))
      : false
    if (media) {
      return (
        <PlaybackCoordinatorProvider>
          <>
            <div className="flex flex-col items-center justify-center min-h-screen">
              <SyncClientWithServerWatched once={true} />
              <Suspense fallback={<Loading />}>
                {mediaPlayerPage ? (
                  <MediaPlayerComponent
                    media={media}
                    mediaTitle={mediaTitle}
                    mediaType={mediaType}
                    goBack={
                      mediaType ? `/list${mediaType ? '/' + mediaType : ''}${TVParams}` : '/list'
                    }
                    searchParams={{ ..._searchParams, start: startTime }}
                    session={session}
                    isValidVideoURL={isValidVideoURL}
                  />
                ) : (
                  <Suspense fallback={<Loading />}>
                    <div className="pt-16 w-full">
                      <TVEpisodeDetailsComponent media={media} />
                    </div>
                  </Suspense>
                )}
              </Suspense>
            </div>
            {/* Episode list for easier navigation */}
            {mediaPlayerPage ? (
              <Suspense fallback={<Loading />}>
                <div className="w-full md:py-12">
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
  } else if (mediaType === 'movie' && mediaTitle && media) {
    const isValidVideoURL = media.videoURL && (await validateVideoURL(media.videoURL))
    return (
      <>
        <SyncClientWithServerWatched once={true} />
        {mediaPlayerPage ? (
          // ex. /list/movie/Inception/play
          <Suspense fallback={<Loading />}>
            <PlaybackCoordinatorProvider>
              <div className="flex flex-col items-center justify-center min-h-screen">
                <MediaPlayerComponent
                  media={media}
                  mediaTitle={mediaTitle}
                  mediaType={mediaType}
                  goBack={
                    mediaType
                      ? `/list${mediaType ? '/' + mediaType + '/' + mediaTitle : ''}${MovieParams}`
                      : '/list'
                  }
                  searchParams={{ ..._searchParams, start: startTime }}
                  session={session}
                  isValidVideoURL={isValidVideoURL}
                />
              </div>
            </PlaybackCoordinatorProvider>
          </Suspense>
        ) : (
          // ex. /list/movie/Inception
          <Suspense fallback={<Loading />}>
            <div className="pt-16 w-full">
              <MovieDetailsComponent media={media} />
            </div>
          </Suspense>
        )}
      </>
    )
  }
  // Enhanced media not found error handling with hierarchical context
  else if (mediaTitle && (!media || mediaNotFoundType)) {
    // Determine the appropriate error message, back link, and poster image based on what wasn't found
    let errorMessage, backHref, backText, posterSrc = '/sorry-image-not-available.jpg', posterAltText = 'Not found'
    let availableSeasons = []
    let showPosterFan = false

    // Try to get the most appropriate poster and seasons data based on the error type
    let contextualMedia = null
    if (mediaNotFoundType === 'season' || mediaNotFoundType === 'episode') {
      // For season/episode errors, try to get the show data with all seasons
      try {
        contextualMedia = await getFlatRequestedMedia({
          type: 'tv',
          title: decodeURIComponent(mediaTitle),
        })
        
        if (contextualMedia?.seasons) {
          // Get available seasons from collection
          const availableSeasonsSet = new Set(contextualMedia.seasons.map(s => s.seasonNumber))
          
          // Format available seasons
          const collectionSeasons = contextualMedia.seasons.map(season => {
            // Try to get air date from TMDB metadata for existing seasons too
            let airDate = season.air_date || null
            
            // If not in season data, check TMDB metadata
            if (!airDate && contextualMedia.metadata?.seasons) {
              const tmdbSeason = contextualMedia.metadata.seasons.find(
                tmdb => tmdb.season_number === season.seasonNumber
              )
              if (tmdbSeason) {
                airDate = tmdbSeason.air_date
              }
            }
            
            return {
              id: season._id,
              seasonNumber: season.seasonNumber,
              title: contextualMedia.title,
              posterUrl: season.posterURL || contextualMedia.posterURL || '/sorry-image-not-available.jpg',
              episodeCount: season.episodes?.length || 0,
              airDate: airDate,
              isAvailable: true
            }
          })
          
          // Get missing seasons from TMDB metadata
          const missingSeasons = []
          if (contextualMedia.metadata?.seasons) {
            contextualMedia.metadata.seasons.forEach(tmdbSeason => {
              if (tmdbSeason.season_number > 0 && !availableSeasonsSet.has(tmdbSeason.season_number)) {
                missingSeasons.push({
                  id: `missing-${tmdbSeason.season_number}`,
                  seasonNumber: tmdbSeason.season_number,
                  title: contextualMedia.title,
                  posterUrl: tmdbSeason.poster_path 
                    ? `https://image.tmdb.org/t/p/w780${tmdbSeason.poster_path}`
                    : contextualMedia.posterURL || '/sorry-image-not-available.jpg',
                  episodeCount: tmdbSeason.episode_count || 0,
                  airDate: tmdbSeason.air_date || null,
                  isAvailable: false
                })
              }
            })
          }
          
          // Combine and sort all seasons
          availableSeasons = [...collectionSeasons, ...missingSeasons].sort((a, b) => a.seasonNumber - b.seasonNumber)
          showPosterFan = true
        }
      } catch (error) {
        // Ignore errors, will use default image
      }
    }

    if (mediaNotFoundType === 'episode' && contextualMedia) {
      // For episode errors, try to get the season poster first
      try {
        const seasonMedia = await getFlatRequestedMedia({
          type: 'tv',
          title: decodeURIComponent(mediaTitle),
          season: mediaSeason,
        })
        if (seasonMedia?.posterURL) {
          posterSrc = seasonMedia.posterURL
        } else if (contextualMedia?.posterURL) {
          posterSrc = contextualMedia.posterURL
          posterAltText = contextualMedia.title
        }
      } catch (error) {
        // Fall back to show poster if season fetch fails
        if (contextualMedia?.posterURL) {
          posterSrc = contextualMedia.posterURL
          posterAltText = contextualMedia.title
        }
      }
    } else if (contextualMedia?.posterURL) {
      // Use show poster for season errors or as fallback
      posterSrc = contextualMedia.posterURL
      posterAltText = contextualMedia.title
    }

    switch (mediaNotFoundType) {
      case 'show':
        errorMessage = `Oops! We couldn't find the TV show "${decodeURIComponent(mediaTitle)}" in our collection. Don't worry, though — we have a wide array of other fantastic shows waiting for you.`
        backHref = `/list/tv`
        backText = 'Browse TV Shows'
        break

      case 'season':
        errorMessage = `We found the show "${decodeURIComponent(mediaTitle)}", but Season ${mediaSeason || 'Unknown'} isn't available in our collection. Check out the available seasons above.`
        backHref = `/list/tv/${mediaTitle}`
        backText = 'View Available Seasons'
        break

      case 'episode':
        errorMessage = `We found Season ${mediaSeason || 'Unknown'} of "${decodeURIComponent(mediaTitle)}", but Episode ${mediaEpisode || 'Unknown'} isn't available. Browse other episodes in this season.`
        backHref = `/list/tv/${mediaTitle}/${mediaSeason}`
        backText = 'View Season Episodes'
        break

      case 'movie':
        errorMessage = `Oops! We couldn't find the movie "${decodeURIComponent(mediaTitle)}" in our collection. Don't worry, though — we have a wide array of other fantastic movies waiting for you.`
        backHref = `/list/movie`
        backText = 'Browse Movies'
        break

      default:
        // Fallback for legacy behavior
        errorMessage = `Oops! It seems like the ${mediaType || 'content'} you're searching for isn't available in our collection. Don't worry, though — we have a wide array of other fantastic ${mediaType === 'tv' ? 'shows' : 'movies'} waiting for you.`
        backHref = `/list${mediaType ? '/' + mediaType : ''}`
        backText = `Browse ${mediaType === 'tv' ? 'TV Shows' : mediaType === 'movie' ? 'Movies' : 'Content'}`
        break
    }

    return (
      <div className="flex min-h-screen flex-col items-center justify-between xl:p-24">
        <div className="flex flex-col max-w-screen-lg w-full">
          {/* Identity Header for Show Context */}
          {showPosterFan && contextualMedia && (
            <div className="mb-6 flex items-center justify-center">
              <div className="flex items-center gap-3 px-4 py-2 bg-black/20 backdrop-blur rounded-lg border border-white/10">
                {/* Tiny poster thumbnail */}
                <Image
                  src={contextualMedia.posterURL || '/sorry-image-not-available.jpg'}
                  alt={contextualMedia.title}
                  width={32}
                  height={48}
                  className="w-8 h-12 object-cover rounded"
                />
                
                {/* Show info */}
                <div className="flex items-center gap-3">
                  <div className="text-left">
                    <h3 className="text-white font-medium text-sm">
                      {contextualMedia.title}
                      {contextualMedia.metadata?.first_air_date && (
                        <span className="text-white/60 ml-1">
                          ({new Date(contextualMedia.metadata.first_air_date).getFullYear()})
                        </span>
                      )}
                    </h3>
                  </div>
                  
                  {/* Status chip */}
                  {contextualMedia.metadata?.status && (
                    <span className="px-2 py-1 text-xs rounded-full bg-white/10 text-white/80 border border-white/20">
                      {contextualMedia.metadata.status}
                    </span>
                  )}
                  
                  {/* View show page link */}
                  <Link
                    href={`/list/tv/${mediaTitle}`}
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
                  >
                    View show page
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                </div>
              </div>
            </div>
          )}

          {showPosterFan && availableSeasons.length > 0 ? (
            <div className="mb-8">
              <PosterFan 
                seasons={availableSeasons} 
                showTitle={mediaTitle}
                targetSeasonNumber={mediaSeason ? parseInt(mediaSeason) : null}
              />
            </div>
          ) : (
            <div className="flex justify-center mb-8">
              <Image
                src={posterSrc}
                alt={posterAltText}
                width={400}
                height={600}
                className="w-3/5 max-w-sm h-auto mx-auto rounded-lg"
              />
            </div>
          )}
          
          <div className="text-center">
            <h2 className="text-lg text-white my-2 max-w-2xl mx-auto">{errorMessage}</h2>
            <Link
              href={backHref}
              className="inline-flex items-center rounded text-center bg-indigo-600 px-4 py-2 text-base font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-4 h-4 mr-2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
                />
              </svg>
              {backText}
            </Link>
          </div>
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
