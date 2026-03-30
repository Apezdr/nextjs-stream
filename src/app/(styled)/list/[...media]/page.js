/**
 * Dynamic Media Page
 *
 * Orchestrates media browsing, details, and playback for movies and TV shows.
 *
 * Routes handled:
 * - /list - Browse all media
 * - /list/movie - Browse movies
 * - /list/tv - Browse TV shows
 * - /list/movie/{title} - Movie details
 * - /list/movie/{title}/play - Movie player
 * - /list/tv/{show} - TV show seasons
 * - /list/tv/{show}/{season} - Season episodes
 * - /list/tv/{show}/{season}/{episode} - Episode details
 * - /list/tv/{show}/{season}/{episode}/play - Episode player
 */

import { notFound, redirect } from 'next/navigation'
import { withApprovedUser } from '@src/components/HOC/ApprovedUser'

// Utilities
import { parseMediaParams } from '@src/utils/media/urlParser'
import { buildMediaMetadata } from '@src/utils/media/metadataBuilder'
import { getCachedMediaWithRedirect } from '@src/utils/cache/mediaFetching'

// Components
import {
  AuthGuard,
  handleLimitedAccess,
  MediaNotFound,
  MoviePlayerView,
  MovieDetailsView,
  TVEpisodePlayerView,
  TVEpisodeDetailsView,
  TVSeasonView,
  TVShowView,
  MovieListView,
  TVListView,
} from '@src/components/MediaPages/DynamicPage'
import { getSession } from '@src/lib/cachedAuth'

function isKnownMediaRoute(params) {
  const segments = params?.media

  if (!Array.isArray(segments) || segments.length === 0) {
    return true
  }

  const [mediaType, mediaTitle, mediaSeason, mediaEpisode, playSegment, ...rest] = segments

  if (rest.length > 0) {
    return false
  }

  if (mediaType !== 'movie' && mediaType !== 'tv') {
    return false
  }

  if (mediaType === 'movie') {
    if (!mediaTitle) {
      return segments.length === 1
    }

    if (segments.length === 2) {
      return true
    }

    return segments.length === 3 && mediaSeason === 'play'
  }

  if (!mediaTitle) {
    return segments.length === 1
  }

  if (segments.length === 2) {
    return true
  }

  if (!mediaSeason) {
    return false
  }

  if (segments.length === 3) {
    return true
  }

  if (!mediaEpisode) {
    return false
  }

  if (segments.length === 4) {
    return true
  }

  return segments.length === 5 && playSegment === 'play'
}

/**
 * Generate metadata for SEO and social sharing
 */
export async function generateMetadata(props, parent) {
  const params = await props.params

  if (!isKnownMediaRoute(params)) {
    notFound()
  }

  const parsedParams = parseMediaParams(params)

  // Fetch media (uses React cache to avoid duplicate fetch in page component)
  const result = await getCachedMediaWithRedirect(parsedParams)

  // Handle redirect if needed
  if (result.redirectUrl) {
    redirect(result.redirectUrl)
  }

  // Build and return metadata
  return buildMediaMetadata(result.media, parsedParams, await parent)
}

/**
 * Main Media Page Component
 */
async function MediaPage({ params, searchParams }) {
  const resolvedParams = await params

  if (!isKnownMediaRoute(resolvedParams)) {
    notFound()
  }

  // Get authentication session
  const session = await getSession()

  // Parse URL parameters
  const parsedParams = parseMediaParams(resolvedParams)
  const _searchParams = await searchParams

  // Fetch media with cached function (shares cache with generateMetadata)
  let result = await getCachedMediaWithRedirect(parsedParams)

  // Handle limited access users (show trailers instead of full content)
  if (session?.user?.limitedAccess && parsedParams.hasTitle) {
    const trailerMedia = await handleLimitedAccess(session, parsedParams)
    if (trailerMedia) {
      // For TV episodes, preserve episode navigation context from original media
      // since getTrailerMedia fetches at show-level (no season/episode)
      if (parsedParams.isTVEpisodeView && result.media) {
        trailerMedia.showTitle = trailerMedia.showTitle ?? result.media.showTitle ?? parsedParams.mediaTitle
        trailerMedia.seasonNumber = trailerMedia.seasonNumber ?? result.media.seasonNumber ?? parsedParams.mediaSeason
        trailerMedia.episodeNumber = trailerMedia.episodeNumber ?? result.media.episodeNumber ?? parsedParams.mediaEpisode
        trailerMedia.season_number = trailerMedia.season_number ?? result.media.season_number ?? parsedParams.mediaSeason
        trailerMedia.episode_number = trailerMedia.episode_number ?? result.media.episode_number ?? parsedParams.mediaEpisode
      }
      result = { media: trailerMedia, redirectUrl: null, notFoundType: null }
    }
  }

  // Handle redirect if needed
  if (result.redirectUrl) {
    redirect(result.redirectUrl)
  }

  const { media, notFoundType } = result

  // Wrap everything in AuthGuard
  return (
    <AuthGuard session={session} parsedParams={parsedParams} media={media}>
      {session?.user && (
        <MediaRouter
          media={media}
          notFoundType={notFoundType}
          session={session}
          searchParams={_searchParams}
          parsedParams={parsedParams}
        />
      )}
    </AuthGuard>
  )
}

/**
 * Route to appropriate view component based on URL parameters
 */
function MediaRouter({ media, notFoundType, session, searchParams, parsedParams }) {
  // Check if user has full access (approved and not limited)
  const hasFullAccess = session?.user?.approved !== false && session?.user?.limitedAccess !== true

  // Handle not found errors
  if (notFoundType) {
    return (
      <MediaNotFound
        notFoundType={notFoundType}
        mediaTitle={parsedParams.mediaTitle}
        mediaSeason={parsedParams.mediaSeason}
        mediaEpisode={parsedParams.mediaEpisode}
      />
    )
  }

  // Route based on media type and parameters
  const {
    isMovie,
    isTVShow,
    isPlayerPage,
    isTVShowSeasonsList,
    isTVSeasonEpisodesList,
    isTVEpisodeView,
    isMovieView,
    isListView,
  } = parsedParams

  // Movie routes
  if (isMovie && isPlayerPage && media) {
    return (
      <MoviePlayerView
        media={media}
        session={session}
        searchParams={searchParams}
        parsedParams={parsedParams}
        hasFullAccess={hasFullAccess}
      />
    )
  }

  if (isMovieView && media) {
    return <MovieDetailsView media={media} />
  }

  // TV routes
  if (isTVEpisodeView && isPlayerPage && media) {
    return (
      <TVEpisodePlayerView
        media={media}
        session={session}
        searchParams={searchParams}
        parsedParams={parsedParams}
        hasFullAccess={hasFullAccess}
      />
    )
  }

  if (isTVEpisodeView && media) {
    return <TVEpisodeDetailsView media={media} />
  }

  if (isTVSeasonEpisodesList && media) {
    return <TVSeasonView media={media} parsedParams={parsedParams} />
  }

  if (isTVShowSeasonsList) {
    return <TVShowView parsedParams={parsedParams} />
  }

  // List views
  if (isListView) {
    return isMovie ? (
      <MovieListView searchParams={searchParams} session={session} />
    ) : (
      <TVListView searchParams={searchParams} session={session} />
    )
  }

  // Fallback: show not found
  return (
    <MediaNotFound
      notFoundType={isMovie ? 'movie' : 'show'}
      mediaTitle={parsedParams.mediaTitle}
      mediaSeason={parsedParams.mediaSeason}
      mediaEpisode={parsedParams.mediaEpisode}
    />
  )
}

// Export with ApprovedUser HOC
export default withApprovedUser(MediaPage)
