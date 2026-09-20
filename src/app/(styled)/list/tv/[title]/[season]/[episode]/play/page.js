import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import PlayerPageSkeleton from '@src/components/MediaPlayer/PlayerPageSkeleton'
import { getSession } from '@src/lib/cachedAuth'
import {
  AuthGuard,
  handleLimitedAccess,
  MediaNotFound,
  TVEpisodePlayerView,
} from '@src/components/MediaPages/DynamicPage'
import { getCachedMediaWithRedirect, applyPlayerDelivery } from '@src/utils/cache/mediaFetching'
import { buildMediaMetadata } from '@src/utils/media/metadataBuilder'

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

async function fetchEpisode(title, season, episode) {
  const parsedParams = buildParsedParams(title, season, episode)
  const result = await getCachedMediaWithRedirect(parsedParams)
  return { parsedParams, result }
}

export async function generateMetadata({ params }, parent) {
  const { title, season, episode } = await params
  const { parsedParams, result } = await fetchEpisode(title, season, episode)
  if (result.redirectUrl) redirect(result.redirectUrl)
  return buildMediaMetadata(result.media, parsedParams, await parent)
}

// Everything that decides what this viewer may see runs here, exactly as it did
// when this was the page component: the session, the approved-account gate, the
// limited-access swap, the redirect, the serve-time delivery decision. The only
// change is where it sits: inside the page's Suspense boundary (below), so the
// route has a prerendered shell.
async function TVEpisodePlayer({ params, searchParams }) {
  const { title, season, episode } = await params
  const _searchParams = (await searchParams) ?? {}
  const session = await getSession()

  // Approved-account gate, before anything is fetched. This page would
  // otherwise render the player for an unapproved account (hasFullAccess only
  // trims the UI). The tv/ layout used to run this check for every page
  // beneath it; each page now runs its own. See the layout's comment.
  if (session?.user && session.user.approved === false) {
    redirect('/auth/error?error=APPROVAL_PENDING')
  }

  const { parsedParams, result: initialResult } = await fetchEpisode(title, season, episode)

  let result = initialResult

  if (session?.user?.limitedAccess && parsedParams.hasTitle) {
    const trailerMedia = await handleLimitedAccess(session, parsedParams)
    if (trailerMedia) {
      if (result.media) {
        trailerMedia.showTitle = trailerMedia.showTitle ?? result.media.showTitle ?? parsedParams.mediaTitle
        trailerMedia.seasonNumber = trailerMedia.seasonNumber ?? result.media.seasonNumber ?? parsedParams.mediaSeason
        trailerMedia.episodeNumber = trailerMedia.episodeNumber ?? result.media.episodeNumber ?? parsedParams.mediaEpisode
        trailerMedia.season_number = trailerMedia.season_number ?? result.media.season_number ?? parsedParams.mediaSeason
        trailerMedia.episode_number = trailerMedia.episode_number ?? result.media.episode_number ?? parsedParams.mediaEpisode
      }
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
          mediaSeason={parsedParams.mediaSeason}
          mediaEpisode={parsedParams.mediaEpisode}
        />
      ) : (
        <TVEpisodePlayerView
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
export default function TVEpisodePlayerPage(props) {
  return (
    <Suspense fallback={<PlayerPageSkeleton />}>
      <TVEpisodePlayer {...props} />
    </Suspense>
  )
}
