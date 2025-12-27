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

import { redirect } from 'next/navigation'
import { auth } from '@src/lib/auth'
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

/**
 * Generate metadata for SEO and social sharing
 */
export async function generateMetadata(props, parent) {
  const params = await props.params
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
  // Get authentication session
  const session = await auth()
  
  // Parse URL parameters
  const parsedParams = parseMediaParams(await params)
  const _searchParams = await searchParams
  
  // Fetch media with cached function (shares cache with generateMetadata)
  let result = await getCachedMediaWithRedirect(parsedParams)
  
  // Handle limited access users (show trailers instead of full content)
  if (session?.user?.limitedAccess && parsedParams.hasTitle) {
    const trailerMedia = await handleLimitedAccess(session, parsedParams)
    if (trailerMedia) {
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
      <MediaRouter
        media={media}
        notFoundType={notFoundType}
        session={session}
        searchParams={_searchParams}
        parsedParams={parsedParams}
      />
    </AuthGuard>
  )
}

/**
 * Route to appropriate view component based on URL parameters
 */
function MediaRouter({ media, notFoundType, session, searchParams, parsedParams }) {
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
    return isMovie ? <MovieListView searchParams={searchParams} /> : <TVListView searchParams={searchParams} />
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