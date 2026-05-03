import { redirect } from 'next/navigation'
import { getSession } from '@src/lib/cachedAuth'
import {
  AuthGuard,
  handleLimitedAccess,
  MediaNotFound,
  MoviePlayerView,
} from '@src/components/MediaPages/DynamicPage'
import { getCachedMediaWithRedirect } from '@src/utils/cache/mediaFetching'
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

export default async function MoviePlayerPage({ params, searchParams }) {
  const { title } = await params
  const _searchParams = (await searchParams) ?? {}
  const session = await getSession()
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
