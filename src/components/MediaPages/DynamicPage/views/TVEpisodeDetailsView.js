/**
 * TV Episode Details View
 *
 * Displays TV episode information without the player.
 * Route: /list/tv/{show}/{season}/{episode}
 *
 * Uses cached component for performance optimization.
 */

import { Suspense } from 'react'
import TVEpisodeDetailsComponent from '@src/components/MediaPages/TVEpisodeDetailsComponent'
import EpisodePageSkeleton from '@src/components/MediaPages/details/EpisodePageSkeleton'
import { cacheLife, cacheTag } from 'next/cache'
import { episodeDetailsTag, tvShowDetailsTag, seasonDetailsTag, MEDIA_CACHE_TAGS } from '@src/utils/cache/mediaPagesTags'

/**
 * Cached Episode Details - Inner component with caching
 */
async function CachedEpisodeDetails({ media }) {
  'use cache'
  cacheLife('mediaLists') // 2 minute stale, revalidates in background
  // The per-title tags by the show's folder name, as the pages and every
  // invalidation key them: an episode's `originalTitle` is its show's folder
  // name (the display `showTitle` only for an episode that lacks one). An
  // episode carries seasonNumber / episodeNumber; the limited-access trailer
  // stand-in carries season_number / episode_number.
  const showKey = media.originalTitle || media.showTitle
  const season = media.seasonNumber ?? media.season_number
  const episode = media.episodeNumber ?? media.episode_number
  cacheTag(
    'media-library',
    'tv',
    MEDIA_CACHE_TAGS.EPISODE_DETAILS,
    tvShowDetailsTag(showKey),
    seasonDetailsTag(showKey, season),
    episodeDetailsTag(showKey, season, episode)
  )
  
  return <TVEpisodeDetailsComponent media={media} />
}

/**
 * TVEpisodeDetailsView Component
 *
 * @param {Object} props
 * @param {Object} props.media - Episode media object
 */
export default function TVEpisodeDetailsView({ media }) {
  return (
    <Suspense fallback={<EpisodePageSkeleton />}>
      <div className="pt-16 w-full">
        <CachedEpisodeDetails media={media} />
      </div>
    </Suspense>
  )
}