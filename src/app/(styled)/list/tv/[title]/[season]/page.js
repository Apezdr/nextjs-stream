import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { cacheLife, cacheTag } from 'next/cache'
import {
  SessionGate,
  MediaNotFound,
  TVSeasonView,
} from '@src/components/MediaPages/DynamicPage'
import SeasonPageSkeleton from '@src/components/MediaPages/details/SeasonPageSkeleton'
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

// See: https://nextjs.org/docs/app/guides/adopting-partial-prefetching
export const prefetch = 'partial'

// Nothing is awaited up here: the params and the session are read by
// SessionGate, inside the boundary, so the skeleton is this route's
// prerendered shell and a link can have it ready before the click.
export default function TVSeasonPage({ params }) {
  return (
    // The page's own frame as the fallback, so switching seasons fills the
    // layout in rather than collapsing to a spinner and reflowing.
    <Suspense fallback={<SeasonPageSkeleton />}>
      <SessionGate
        params={params}
        callbackUrl={({ title, season }) =>
          `/list/tv/${encodeURIComponent(title)}/${encodeURIComponent(season)}`
        }
      >
        {({ session, params: { title, season } }) => (
          <TVSeasonContent
            title={title}
            season={season}
            isLimitedAccess={!!session.user.limitedAccess}
            userId={session.user.id}
          />
        )}
      </SessionGate>
    </Suspense>
  )
}
