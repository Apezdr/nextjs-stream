import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import PlayerPageSkeleton from '@src/components/MediaPlayer/PlayerPageSkeleton'
import { getSession } from '@src/lib/cachedAuth'
import {
  AuthGuard,
  MediaNotFound,
  MoviePlayerView,
} from '@src/components/MediaPages/DynamicPage'
import { getCachedMediaWithRedirect, applyPlayerDelivery } from '@src/utils/cache/mediaFetching'
import { buildMediaMetadata } from '@src/utils/media/metadataBuilder'
import { isAwaitingApproval } from '@src/lib/roles/rules'
import { libraryAccessOrPublic, pageLibraryAccess } from '@src/lib/roles/session'

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

async function fetchMovieForPlayer(title, access) {
  const parsedParams = buildPlayerParsedParams(title)
  const result = await getCachedMediaWithRedirect(parsedParams, access)
  return { parsedParams, result }
}

export async function generateMetadata({ params }, parent) {
  const { title } = await params
  const { parsedParams, result } = await fetchMovieForPlayer(title, await pageLibraryAccess())
  if (result.redirectUrl) redirect(result.redirectUrl)
  return buildMediaMetadata(result.media, parsedParams, await parent)
}

// Everything that decides what this viewer may see runs here, exactly as it did
// when this was the page component: the session, the approved-account gate, the
// viewer's library scope (a title outside it is not found), the redirect, the
// serve-time delivery decision. The only change is where it sits: inside the page's Suspense boundary (below), so the
// route has a prerendered shell.
async function MoviePlayer({ params, searchParams }) {
  const { title } = await params
  const _searchParams = (await searchParams) ?? {}
  const session = await getSession()

  // Approved-account gate, before anything is fetched. This page would
  // otherwise render the player for an unapproved account. The movie/ layout
  // used to run this check for every page beneath it; each page now runs its own. See the layout's comment.
  if (isAwaitingApproval(session?.user)) {
    redirect('/auth/error?error=APPROVAL_PENDING')
  }

  // A signed-out visitor gets AuthGuard's sign-in teaser (libraryAccessOrPublic)
  const access = await libraryAccessOrPublic()
  const { parsedParams, result: initialResult } = await fetchMovieForPlayer(title, access)

  let result = initialResult

  if (result.redirectUrl) {
    redirect(result.redirectUrl)
  }

  // Serve-time JIT delivery decision — per request, OUTSIDE the cached fetch
  // (mode/health/overrides must never be frozen into a cache entry).
  result = await applyPlayerDelivery(result, parsedParams)

  const { media, notFoundType } = result

  return (
    <AuthGuard session={session} parsedParams={parsedParams} media={media}>
      {!session?.user ? null : notFoundType ? (
        <MediaNotFound
          notFoundType={notFoundType}
          mediaTitle={parsedParams.mediaTitle}
          access={access}
        />
      ) : (
        <MoviePlayerView
          media={media}
          session={session}
          searchParams={_searchParams}
          parsedParams={parsedParams}
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
