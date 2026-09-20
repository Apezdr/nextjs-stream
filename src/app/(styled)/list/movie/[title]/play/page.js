import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import PlayerPageSkeleton from '@src/components/MediaPlayer/PlayerPageSkeleton'
import { getSession } from '@src/lib/cachedAuth'
import {
  AuthGuard,
  handleLimitedAccess,
  MediaNotFound,
  MoviePlayerView,
} from '@src/components/MediaPages/DynamicPage'
import { getCachedMediaWithRedirect, applyPlayerDelivery } from '@src/utils/cache/mediaFetching'
import { buildMediaMetadata } from '@src/utils/media/metadataBuilder'

function buildPlayerParsedParams(title) {
  const decoded = decodeURIComponent(title)
  return {
    mediaType: 'movie',
    mediaTitle: decoded,
    mediaSeason: undefined,
    mediaEpisode: undefined,
    isPlayerPage: true,
    isMovie: true,
    isTVShow: false,
    hasTitle: true,
    hasSeason: false,
    hasEpisode: false,
    isMovieView: true,
    isTVShowSeasonsList: false,
    isTVSeasonEpisodesList: false,
    isTVEpisodeView: false,
    isListView: false,
  }
}

async function fetchMovieForPlayer(title) {
  const parsedParams = buildPlayerParsedParams(title)
  const result = await getCachedMediaWithRedirect(parsedParams)
  return { parsedParams, result }
}

export async function generateMetadata({ params }, parent) {
  const { title } = await params
  const { parsedParams, result } = await fetchMovieForPlayer(title)
  if (result.redirectUrl) redirect(result.redirectUrl)
  return buildMediaMetadata(result.media, parsedParams, await parent)
}

// Everything that decides what this viewer may see runs here, exactly as it did
// when this was the page component: the session, the approved-account gate, the
// limited-access swap, the redirect, the serve-time delivery decision. The only
// change is where it sits: inside the page's Suspense boundary (below), so the
// route has a prerendered shell.
async function MoviePlayer({ params, searchParams }) {
  const { title } = await params
  const _searchParams = (await searchParams) ?? {}
  const session = await getSession()

  // Approved-account gate, before anything is fetched. This page would
  // otherwise render the player for an unapproved account (hasFullAccess only
  // trims the UI). The movie/ layout used to run this check for every page
  // beneath it; each page now runs its own. See the layout's comment.
  if (session?.user && session.user.approved === false) {
    redirect('/auth/error?error=APPROVAL_PENDING')
  }

  const { parsedParams, result: initialResult } = await fetchMovieForPlayer(title)

  let result = initialResult

  if (session?.user?.limitedAccess && parsedParams.hasTitle) {
    const trailerMedia = await handleLimitedAccess(session, parsedParams)
    if (trailerMedia) {
      result = { media: trailerMedia, redirectUrl: null, notFoundType: null }
    }
  }

  if (result.redirectUrl) {
    redirect(result.redirectUrl)
  }

  // Serve-time JIT delivery decision — per request, OUTSIDE the cached fetch
  // (mode/health/overrides must never be frozen into a cache entry).
  result = await applyPlayerDelivery(result, parsedParams)

  const { media, notFoundType } = result
  const hasFullAccess =
    session?.user?.approved !== false && session?.user?.limitedAccess !== true

  return (
    <AuthGuard session={session} parsedParams={parsedParams} media={media}>
      {!session?.user ? null : notFoundType ? (
        <MediaNotFound
          notFoundType={notFoundType}
          mediaTitle={parsedParams.mediaTitle}
        />
      ) : (
        <MoviePlayerView
          media={media}
          session={session}
          searchParams={_searchParams}
          parsedParams={parsedParams}
          hasFullAccess={hasFullAccess}
        />
      )}
    </AuthGuard>
  )
}

// Nothing is awaited here. The black player frame is this route's prerendered
// shell, so the Play button has something to show the moment it is clicked.
export default function MoviePlayerPage(props) {
  return (
    <Suspense fallback={<PlayerPageSkeleton />}>
      <MoviePlayer {...props} />
    </Suspense>
  )
}
