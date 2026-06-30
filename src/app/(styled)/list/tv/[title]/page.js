import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { cacheLife, cacheTag } from 'next/cache'
import { getSession } from '@src/lib/cachedAuth'
import {
  AuthGuard,
  MediaNotFound,
  TVShowView,
} from '@src/components/MediaPages/DynamicPage'
import Loading from '@src/app/loading'
import { getCachedMediaWithRedirect } from '@src/utils/cache/mediaFetching'
import { fetchTrailerMedia } from '@src/utils/media/mediaFetcher'
import { buildMediaMetadata } from '@src/utils/media/metadataBuilder'
import { tvShowDetailsTag, MEDIA_CACHE_TAGS } from '@src/utils/cache/mediaPagesTags'

function buildParsedParams(title) {
  return {
    mediaType: 'tv',
    mediaTitle: decodeURIComponent(title),
    mediaSeason: undefined,
    mediaEpisode: undefined,
    isPlayerPage: false,
    isMovie: false,
    isTVShow: true,
    hasTitle: true,
    hasSeason: false,
    hasEpisode: false,
    isMovieView: false,
    isTVShowSeasonsList: true,
    isTVSeasonEpisodesList: false,
    isTVEpisodeView: false,
    isListView: false,
  }
}

async function fetchShow(title) {
  const parsedParams = buildParsedParams(title)
  const result = await getCachedMediaWithRedirect(parsedParams)
  return { parsedParams, result }
}

/**
 * Cached subtree — owns the data fetch and the rendered output. Layout +
 * AuthGuard wrap this in a Suspense boundary so the page chrome paints
 * immediately while the cached subtree resolves (or returns instantly when
 * warm). Cache is keyed by `{ title, isLimitedAccess }`, so non-limited
 * users share a single cache entry per show.
 */
async function TVShowContent({ title, isLimitedAccess }) {
  'use cache'
  cacheLife('mediaLists')
  cacheTag('media-library', 'tv', MEDIA_CACHE_TAGS.TV_DETAILS, tvShowDetailsTag(decodeURIComponent(title)))

  const parsedParams = buildParsedParams(title)
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
      />
    )
  }

  return <TVShowView parsedParams={parsedParams} />
}

export async function generateMetadata({ params }, parent) {
  const { title } = await params
  const { parsedParams, result } = await fetchShow(title)
  if (result.redirectUrl) redirect(result.redirectUrl)
  return buildMediaMetadata(result.media, parsedParams, await parent)
}

export default async function TVShowPage({ params }) {
  const { title } = await params
  const session = await getSession()
  const isLimitedAccess = !!session?.user?.limitedAccess

  return (
    <AuthGuard
      session={session}
      callbackUrl={`/list/tv/${encodeURIComponent(title)}`}
      variant="skeleton"
    >
      <Suspense fallback={<Loading />}>
        <TVShowContent title={title} isLimitedAccess={isLimitedAccess} />
      </Suspense>
    </AuthGuard>
  )
}
