import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { cacheLife, cacheTag } from 'next/cache'
import { getSession } from '@src/lib/cachedAuth'
import {
  AuthGuard,
  MediaNotFound,
  TVEpisodeDetailsView,
} from '@src/components/MediaPages/DynamicPage'
import Loading from '@src/app/loading'
import { getCachedMediaWithRedirect } from '@src/utils/cache/mediaFetching'
import { fetchTrailerMedia } from '@src/utils/media/mediaFetcher'
import { buildMediaMetadata } from '@src/utils/media/metadataBuilder'
import { episodeDetailsTag, MEDIA_CACHE_TAGS } from '@src/utils/cache/mediaPagesTags'

function buildParsedParams(title, season, episode) {
  return {
    mediaType: 'tv',
    mediaTitle: decodeURIComponent(title),
    mediaSeason: decodeURIComponent(season),
    mediaEpisode: decodeURIComponent(episode),
    isPlayerPage: false,
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

async function TVEpisodeContent({ title, season, episode, isLimitedAccess }) {
  'use cache'
  cacheLife('mediaLists')
  cacheTag(
    'media-library',
    'tv',
    MEDIA_CACHE_TAGS.EPISODE_DETAILS,
    episodeDetailsTag(decodeURIComponent(title), decodeURIComponent(season), decodeURIComponent(episode))
  )

  const parsedParams = buildParsedParams(title, season, episode)
  let result = await getCachedMediaWithRedirect(parsedParams)

  if (isLimitedAccess && parsedParams.hasTitle) {
    const trailerMedia = await fetchTrailerMedia(parsedParams.mediaType, parsedParams.mediaTitle)
    if (trailerMedia) {
      // Trailer fetch is show-level — preserve episode navigation context
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

  if (result.notFoundType) {
    return (
      <MediaNotFound
        notFoundType={result.notFoundType}
        mediaTitle={parsedParams.mediaTitle}
        mediaSeason={parsedParams.mediaSeason}
        mediaEpisode={parsedParams.mediaEpisode}
      />
    )
  }

  return <TVEpisodeDetailsView media={result.media} />
}

export async function generateMetadata({ params }, parent) {
  const { title, season, episode } = await params
  const { parsedParams, result } = await fetchEpisode(title, season, episode)
  if (result.redirectUrl) redirect(result.redirectUrl)
  return buildMediaMetadata(result.media, parsedParams, await parent)
}

export default async function TVEpisodePage({ params }) {
  const { title, season, episode } = await params
  const session = await getSession()
  const isLimitedAccess = !!session?.user?.limitedAccess

  return (
    <AuthGuard
      session={session}
      callbackUrl={`/list/tv/${encodeURIComponent(title)}/${encodeURIComponent(season)}/${encodeURIComponent(episode)}`}
      variant="skeleton"
    >
      <Suspense fallback={<Loading />}>
        <TVEpisodeContent
          title={title}
          season={season}
          episode={episode}
          isLimitedAccess={isLimitedAccess}
        />
      </Suspense>
    </AuthGuard>
  )
}
