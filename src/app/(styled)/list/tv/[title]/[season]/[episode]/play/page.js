import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import PlayerPageSkeleton from '@src/components/MediaPlayer/PlayerPageSkeleton'
import { getSession } from '@src/lib/cachedAuth'
import {
  AuthGuard,
  MediaNotFound,
  TVEpisodePlayerView,
} from '@src/components/MediaPages/DynamicPage'
import { getCachedMediaWithRedirect, applyPlayerDelivery } from '@src/utils/cache/mediaFetching'
import { buildMediaMetadata } from '@src/utils/media/metadataBuilder'
import { isAwaitingApproval } from '@src/lib/roles/rules'
import { libraryAccessOrPublic, pageLibraryAccess } from '@src/lib/roles/session'

function buildParsedParams(title, season, episode) {
  return {
    mediaType: 'tv',
    mediaTitle: decodeURIComponent(title),
    mediaSeason: decodeURIComponent(season),
    mediaEpisode: decodeURIComponent(episode),
    isPlayerPage: true,
    isMovie: false,
    isTVShow: true,
    hasTitle: true,
    hasSeason: true,
    hasEpisode: true,
    isMovieView: false,
    isTVShowSeasonsList: false,
    isTVSeasonEpisodesList: false,
    isTVEpisodeView: true,
    isListView: false,
  }
}

async function fetchEpisode(title, season, episode, access) {
  const parsedParams = buildParsedParams(title, season, episode)
  const result = await getCachedMediaWithRedirect(parsedParams, access)
  return { parsedParams, result }
}

export async function generateMetadata({ params }, parent) {
  const { title, season, episode } = await params
  const { parsedParams, result } = await fetchEpisode(title, season, episode, await pageLibraryAccess())
  if (result.redirectUrl) redirect(result.redirectUrl)
  return buildMediaMetadata(result.media, parsedParams, await parent)
}

// Everything that decides what this viewer may see runs here, exactly as it did
// when this was the page component: the session, the approved-account gate, the
// viewer's library scope (a show outside it is not found), the redirect, the
// serve-time delivery decision. The only change is where it sits: inside the page's Suspense boundary (below), so the
// route has a prerendered shell.
async function TVEpisodePlayer({ params, searchParams }) {
  const { title, season, episode } = await params
  const _searchParams = (await searchParams) ?? {}
  const session = await getSession()

  // Approved-account gate, before anything is fetched. This page would
  // otherwise render the player for an unapproved account. The tv/ layout used
  // to run this check for every page beneath it; each page now runs its own. See the layout's comment.
  if (isAwaitingApproval(session?.user)) {
    redirect('/auth/error?error=APPROVAL_PENDING')
  }

  // A signed-out visitor gets AuthGuard's sign-in teaser (libraryAccessOrPublic)
  const access = await libraryAccessOrPublic()
  const { parsedParams, result: initialResult } = await fetchEpisode(title, season, episode, access)

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
          mediaSeason={parsedParams.mediaSeason}
          mediaEpisode={parsedParams.mediaEpisode}
          access={access}
        />
      ) : (
        <TVEpisodePlayerView
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
export default function TVEpisodePlayerPage(props) {
  return (
    <Suspense fallback={<PlayerPageSkeleton />}>
      <TVEpisodePlayer {...props} />
    </Suspense>
  )
}
