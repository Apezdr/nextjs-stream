/**
 * Movie Details View
 *
 * Displays movie information without the player.
 * Route: /list/movie/{title}
 *
 * Uses cached component for performance optimization.
 */

import { Suspense } from 'react'
import MovieDetailsComponent from '@src/components/MediaPages/MovieDetailsComponent'
import Loading from '@src/app/loading'
import { cacheLife, cacheTag } from 'next/cache'
import { movieDetailsTag, MEDIA_CACHE_TAGS } from '@src/utils/cache/mediaPagesTags'

/**
 * Cached Movie Details - Inner component with caching
 */
async function CachedMovieDetails({ media }) {
  'use cache'
  cacheLife('mediaLists') // 2 minute stale, revalidates in background
  cacheTag('media-library', 'movies', MEDIA_CACHE_TAGS.MOVIE_DETAILS, movieDetailsTag(media.title))
  
  return <MovieDetailsComponent media={media} />
}

/**
 * MovieDetailsView Component
 *
 * @param {Object} props
 * @param {Object} props.media - Movie media object
 */
export default function MovieDetailsView({ media }) {
  return (
    <Suspense fallback={<Loading />}>
      <div className="pt-16 w-full">
        <CachedMovieDetails media={media} />
      </div>
    </Suspense>
  )
}