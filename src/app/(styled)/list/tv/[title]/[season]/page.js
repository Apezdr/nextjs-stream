import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { cacheLife, cacheTag } from 'next/cache'
import { getSession } from '@src/lib/cachedAuth'
import {
  AuthGuard,
  MediaNotFound,
  TVSeasonView,
} from '@src/components/MediaPages/DynamicPage'
import Loading from '@src/app/loading'
import { getCachedMediaWithRedirect } from '@src/utils/cache/mediaFetching'
import { fetchTrailerMedia } from '@src/utils/media/mediaFetcher'
import { buildMediaMetadata } from '@src/utils/media/metadataBuilder'
import { seasonDetailsTag, MEDIA_CACHE_TAGS } from '@src/utils/cache/mediaPagesTags'

function buildParsedParams(title, season) {
  return {
    mediaType: 'tv',
    mediaTitle: decodeURIComponent(title),
    mediaSeason: decodeURIComponent(season),
    mediaEpisode: undefined,
    isPlayerPage: false,
    isMovie: false,
    isTVShow: true,
    hasTitle: true,
    hasSeason: true,
    hasEpisode: false,
    isMovieView: false,
    isTVShowSeasonsList: false,
    isTVSeasonEpisodesList: true,
    isTVEpisodeView: false,
    isListView: false,
  }
}

async function fetchSeason(title, season) {
  const parsedParams = buildParsedParams(title, season)
  const result = await getCachedMediaWithRedirect(parsedParams)
  return { parsedParams, result }
}

async function TVSeasonContent({ title, season, isLimitedAccess, userId }) {
  'use cache'
  cacheLife('mediaLists')
  cacheTag(
    'media-library',
    'tv',
    MEDIA_CACHE_TAGS.SEASON_DETAILS,
    seasonDetailsTag(decodeURIComponent(title), decodeURIComponent(season)),
    `user-watch-history-${userId ?? 'anon'}`
  )

  const parsedParams = buildParsedParams(title, season)
  let result = await getCachedMediaWithRedirect(parsedParams)

  if (isLimitedAccess && parsedParams.hasTitle) {
    const trailerMedia = await fetchTrailerMedia(parsedParams.mediaType, parsedParams.mediaTitle)
    if (trailerMedia) {
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
      />
    )
  }

  return <TVSeasonView media={result.media} parsedParams={parsedParams} userId={userId} />
}

export async function generateMetadata({ params }, parent) {
  const { title, season } = await params
  const { parsedParams, result } = await fetchSeason(title, season)
  if (result.redirectUrl) redirect(result.redirectUrl)
  return buildMediaMetadata(result.media, parsedParams, await parent)
}

export default async function TVSeasonPage({ params }) {
  const { title, season } = await params
  const session = await getSession()
  const isLimitedAccess = !!session?.user?.limitedAccess
  const userId = session?.user?.id

  return (
    <AuthGuard
      session={session}
      callbackUrl={`/list/tv/${encodeURIComponent(title)}/${encodeURIComponent(season)}`}
      variant="skeleton"
    >
      <Suspense fallback={<Loading />}>
        <TVSeasonContent
          title={title}
          season={season}
          isLimitedAccess={isLimitedAccess}
          userId={userId}
        />
      </Suspense>
    </AuthGuard>
  )
}
