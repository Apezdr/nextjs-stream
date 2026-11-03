import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { cacheLife, cacheTag } from 'next/cache'
import {
  SessionGate,
  MediaNotFound,
  TVEpisodeDetailsView,
} from '@src/components/MediaPages/DynamicPage'
import EpisodePageSkeleton from '@src/components/MediaPages/details/EpisodePageSkeleton'
import { getCachedMediaWithRedirect } from '@src/utils/cache/mediaFetching'
import { buildMediaMetadata } from '@src/utils/media/metadataBuilder'
import { episodeDetailsTag, MEDIA_CACHE_TAGS } from '@src/utils/cache/mediaPagesTags'
import { pageLibraryAccess } from '@src/lib/roles/session'

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

async function fetchEpisode(title, season, episode, access) {
  const parsedParams = buildParsedParams(title, season, episode)
  const result = await getCachedMediaWithRedirect(parsedParams, access)
  return { parsedParams, result }
}

async function TVEpisodeContent({ title, season, episode, access }) {
  'use cache'
  cacheLife('mediaLists')
  cacheTag(
    'media-library',
    'tv',
    MEDIA_CACHE_TAGS.EPISODE_DETAILS,
    episodeDetailsTag(decodeURIComponent(title), decodeURIComponent(season), decodeURIComponent(episode))
  )

  const parsedParams = buildParsedParams(title, season, episode)
  const result = await getCachedMediaWithRedirect(parsedParams, access)

  if (result.redirectUrl) {
    redirect(result.redirectUrl)
  }

  if (result.notFoundType) {
    return (
      <MediaNotFound
        notFoundType={result.notFoundType}
        mediaTitle={parsedParams.mediaTitle}
        access={access}
        mediaSeason={parsedParams.mediaSeason}
        mediaEpisode={parsedParams.mediaEpisode}
      />
    )
  }

  return <TVEpisodeDetailsView media={result.media} />
}

export async function generateMetadata({ params }, parent) {
  const { title, season, episode } = await params
  const { parsedParams, result } = await fetchEpisode(title, season, episode, await pageLibraryAccess())
  if (result.redirectUrl) redirect(result.redirectUrl)
  return buildMediaMetadata(result.media, parsedParams, await parent)
}

// Nothing is awaited up here: the params and the session are read by
// SessionGate, inside the boundary, so the skeleton is this route's
// prerendered shell and a link can have it ready before the click.
export default function TVEpisodePage({ params }) {
  return (
    // The page's own frame as the fallback, so moving between episodes fills
    // the layout in rather than collapsing to a spinner and reflowing.
    <Suspense fallback={<EpisodePageSkeleton />}>
      <SessionGate
        params={params}
        callbackUrl={({ title, season, episode }) =>
          `/list/tv/${title}/${season}/${episode}`
        }
      >
        {({ session, params: { title, season, episode } }) => (
          <TVEpisodeContent
            title={title}
            season={season}
            episode={episode}
            access={session.access}
          />
        )}
      </SessionGate>
    </Suspense>
  )
}
