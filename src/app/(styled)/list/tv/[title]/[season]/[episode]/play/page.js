import { redirect } from 'next/navigation'
import { getSession } from '@src/lib/cachedAuth'
import {
  AuthGuard,
  handleLimitedAccess,
  MediaNotFound,
  TVEpisodePlayerView,
} from '@src/components/MediaPages/DynamicPage'
import { getCachedMediaWithRedirect } from '@src/utils/cache/mediaFetching'
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

export default async function TVEpisodePlayerPage({ params, searchParams }) {
  const { title, season, episode } = await params
  const _searchParams = (await searchParams) ?? {}
  const session = await getSession()
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
