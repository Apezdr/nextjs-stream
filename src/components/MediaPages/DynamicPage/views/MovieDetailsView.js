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
import MoviePageSkeleton from '@src/components/MediaPages/details/MoviePageSkeleton'
import { cacheLife, cacheTag } from 'next/cache'
import { movieDetailsTag, MEDIA_CACHE_TAGS } from '@src/utils/cache/mediaPagesTags'

/**
 * Cached Movie Details - Inner component with caching
 */
async function CachedMovieDetails({ media, access }) {
  'use cache'
  cacheLife('mediaLists') // 2 minute stale, revalidates in background
  // The per-title tag by folder name, as the page and every invalidation key it
  cacheTag('media-library', 'movies', MEDIA_CACHE_TAGS.MOVIE_DETAILS, movieDetailsTag(media.originalTitle || media.title))
  
  return <MovieDetailsComponent media={media} access={access} />
}

/**
 * MovieDetailsView Component
 *
 * @param {Object} props
 * @param {Object} props.media - Movie media object
 * @param {Object} props.access - The viewer's LibraryAccess (the collection strip is scoped by it)
 */
export default function MovieDetailsView({ media, access }) {
  return (
    <Suspense fallback={<MoviePageSkeleton />}>
      <div className="pt-16 w-full">
        <CachedMovieDetails media={media} access={access} />
      </div>
    </Suspense>
  )
}