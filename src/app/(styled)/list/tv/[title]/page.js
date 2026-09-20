import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { cacheLife, cacheTag } from 'next/cache'
import {
  SessionGate,
  MediaNotFound,
  TVShowView,
} from '@src/components/MediaPages/DynamicPage'
import ShowPageSkeleton from '@src/components/MediaPages/details/ShowPageSkeleton'
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
 * Cached subtree — owns the data fetch and the rendered output. The page
 * renders it behind SessionGate, inside a Suspense boundary whose fallback is
 * the page skeleton, so the skeleton paints at once (it is the route's
 * prerendered shell) while this resolves, or returns instantly when warm. Cache is keyed by `{ title, isLimitedAccess, userId }`: the page
 * shows the viewer's next-up episode and per-season progress, so every
 * viewer has their own entry, tagged with their watch history so a playback
 * write expires it. Nothing inside may read the session — the viewer is
 * known only through the `userId` argument.
 */
async function TVShowContent({ title, isLimitedAccess, userId }) {
  'use cache'
  cacheLife('mediaLists')
  cacheTag(
    'media-library',
    'tv',
    MEDIA_CACHE_TAGS.TV_DETAILS,
    tvShowDetailsTag(decodeURIComponent(title)),
    `user-watch-history-${userId ?? 'anon'}`
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

  return <TVShowView parsedParams={parsedParams} media={result.media} userId={userId} />
}

export async function generateMetadata({ params }, parent) {
  const { title } = await params
  const { parsedParams, result } = await fetchShow(title)
  if (result.redirectUrl) redirect(result.redirectUrl)
  return buildMediaMetadata(result.media, parsedParams, await parent)
}

// Nothing is awaited up here: the params and the session are read by
// SessionGate, inside the boundary, so the skeleton is this route's
// prerendered shell and a link can have it ready before the click.
export default function TVShowPage({ params }) {
  return (
    // The page's own frame as the fallback (and so as this route's shell)
    <Suspense fallback={<ShowPageSkeleton />}>
      <SessionGate params={params} callbackUrl={({ title }) => `/list/tv/${encodeURIComponent(title)}`}>
        {({ session, params: { title } }) => (
          <TVShowContent
            title={title}
            isLimitedAccess={!!session.user.limitedAccess}
            userId={session.user.id}
          />
        )}
      </SessionGate>
    </Suspense>
  )
}
