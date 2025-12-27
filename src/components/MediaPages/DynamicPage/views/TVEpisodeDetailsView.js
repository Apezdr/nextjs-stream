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
import Loading from '@src/app/loading'
import { cacheLife, cacheTag } from 'next/cache'
import { episodeDetailsTag, tvShowDetailsTag, seasonDetailsTag, MEDIA_CACHE_TAGS } from '@src/utils/cache/mediaPagesTags'

/**
 * Cached Episode Details - Inner component with caching
 */
async function CachedEpisodeDetails({ media }) {
  'use cache'
  cacheLife('mediaLists') // 2 minute stale, revalidates in background
  cacheTag(
    'media-library',
    'tv',
    MEDIA_CACHE_TAGS.EPISODE_DETAILS,
    tvShowDetailsTag(media.showTitle),
    seasonDetailsTag(media.showTitle, media.season_number),
    episodeDetailsTag(media.showTitle, media.season_number, media.episode_number)
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
    <Suspense fallback={<Loading />}>
      <div className="pt-16 w-full">
        <CachedEpisodeDetails media={media} />
      </div>
    </Suspense>
  )
}