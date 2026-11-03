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
import { buildMediaMetadata } from '@src/utils/media/metadataBuilder'
import { movieDetailsTag, MEDIA_CACHE_TAGS } from '@src/utils/cache/mediaPagesTags'
import { pageLibraryAccess } from '@src/lib/roles/session'
import { libraryAccessById } from '@src/lib/roles/libraryAccess'

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

async function fetchMovie(title, access) {
  const parsedParams = buildParsedParams(title)
  const result = await getCachedMediaWithRedirect(parsedParams, access.id)
  return { parsedParams, result }
}

/**
 * Cached subtree — owns the data fetch and the rendered output. The page
 * renders it behind SessionGate, inside a Suspense boundary whose fallback is
 * the page skeleton, so the skeleton paints at once (it is the route's
 * prerendered shell) while this resolves, or returns instantly when warm. Cache is keyed by
 * `{ title, scopeId }` (the viewer's LibraryAccess.id): viewers with the same library scope share one entry per movie,
 * and a movie outside the scope renders as not found.
 */
async function MovieDetailContent({ title, scopeId }) {
  'use cache'
  cacheLife('mediaLists')
  cacheTag(
    'media-library',
    'movies',
    MEDIA_CACHE_TAGS.MOVIE_DETAILS,
    movieDetailsTag(decodeURIComponent(title))
  )

  const parsedParams = buildParsedParams(title)
  const access = await libraryAccessById(scopeId)
  const result = await getCachedMediaWithRedirect(parsedParams, scopeId)

  if (result.redirectUrl) {
    redirect(result.redirectUrl)
  }

  if (result.notFoundType) {
    return (
      <MediaNotFound
        notFoundType={result.notFoundType}
        mediaTitle={parsedParams.mediaTitle}
        access={access}
      />
    )
  }

  return <MovieDetailsView media={result.media} scopeId={scopeId} />
}

export async function generateMetadata({ params }, parent) {
  const { title } = await params
  const { parsedParams, result } = await fetchMovie(title, await pageLibraryAccess())
  if (result.redirectUrl) redirect(result.redirectUrl)
  return buildMediaMetadata(result.media, parsedParams, await parent)
}

// Nothing is awaited up here: the params and the session are read by
// SessionGate, inside the boundary, so the skeleton is this route's
// prerendered shell and a link can have it ready before the click.
export default function MovieDetailPage({ params }) {
  return (
    // The page's own frame as the fallback (and so as this route's shell)
    <Suspense fallback={<MoviePageSkeleton />}>
      <SessionGate params={params} callbackUrl={({ title }) => `/list/movie/${title}`}>
        {({ session, params: { title } }) => (
          <MovieDetailContent title={title} scopeId={session.access.id} />
        )}
      </SessionGate>
    </Suspense>
  )
}
