import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { cacheLife, cacheTag } from 'next/cache'
import {
  SessionGate,
  MediaNotFound,
  MovieDetailsView,
} from '@src/components/MediaPages/DynamicPage'
import MoviePageSkeleton from '@src/components/MediaPages/details/MoviePageSkeleton'
import { getCachedMediaWithRedirect } from '@src/utils/cache/mediaFetching'
import { fetchTrailerMedia } from '@src/utils/media/mediaFetcher'
import { buildMediaMetadata } from '@src/utils/media/metadataBuilder'
import { movieDetailsTag, MEDIA_CACHE_TAGS } from '@src/utils/cache/mediaPagesTags'

function buildParsedParams(title) {
  return {
    mediaType: 'movie',
    mediaTitle: decodeURIComponent(title),
    mediaSeason: undefined,
    mediaEpisode: undefined,
    isPlayerPage: false,
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

async function fetchMovie(title) {
  const parsedParams = buildParsedParams(title)
  const result = await getCachedMediaWithRedirect(parsedParams)
  return { parsedParams, result }
}

/**
 * Cached subtree — owns the data fetch and the rendered output. Layout +
 * AuthGuard wrap this in a Suspense boundary so the page chrome paints
 * immediately while the cached subtree resolves (or returns instantly when
 * warm). Cache is keyed by `{ title, isLimitedAccess }`, so non-limited
 * users share a single cache entry per movie.
 */
async function MovieDetailContent({ title, isLimitedAccess }) {
  'use cache'
  cacheLife('mediaLists')
  cacheTag(
    'media-library',
    'movies',
    MEDIA_CACHE_TAGS.MOVIE_DETAILS,
    movieDetailsTag(decodeURIComponent(title))
  )

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

  return <MovieDetailsView media={result.media} />
}

export async function generateMetadata({ params }, parent) {
  const { title } = await params
  const { parsedParams, result } = await fetchMovie(title)
  if (result.redirectUrl) redirect(result.redirectUrl)
  return buildMediaMetadata(result.media, parsedParams, await parent)
}

// See: https://nextjs.org/docs/app/guides/adopting-partial-prefetching
export const prefetch = 'partial'

// Nothing is awaited up here: the params and the session are read by
// SessionGate, inside the boundary, so the skeleton is this route's
// prerendered shell and a link can have it ready before the click.
export default function MovieDetailPage({ params }) {
  return (
    // The page's own frame as the fallback (and so as this route's shell)
    <Suspense fallback={<MoviePageSkeleton />}>
      <SessionGate params={params} callbackUrl={({ title }) => `/list/movie/${encodeURIComponent(title)}`}>
        {({ session, params: { title } }) => (
          <MovieDetailContent title={title} isLimitedAccess={!!session.user.limitedAccess} />
        )}
      </SessionGate>
    </Suspense>
  )
}
