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
import { libraryAccessById } from '@src/lib/roles/libraryAccess'

/**
 * Cached Movie Details - Inner component with caching
 */
async function CachedMovieDetails({ media, scopeId }) {
  'use cache'
  cacheLife('mediaLists') // 2 minute stale, revalidates in background
  // The per-title tag by folder name, as the page and every invalidation key it
  cacheTag('media-library', 'movies', MEDIA_CACHE_TAGS.MOVIE_DETAILS, movieDetailsTag(media.originalTitle || media.title))
  
  return <MovieDetailsComponent media={media} access={await libraryAccessById(scopeId)} />
}

/**
 * MovieDetailsView Component
 *
 * @param {Object} props
 * @param {Object} props.media - Movie media object
 * @param {string} props.scopeId - The viewer's LibraryAccess.id (the collection strip is scoped by it)
 */
export default function MovieDetailsView({ media, scopeId }) {
  return (
    <Suspense fallback={<MoviePageSkeleton />}>
      <div className="pt-16 w-full">
        <CachedMovieDetails media={media} scopeId={scopeId} />
      </div>
    </Suspense>
  )
}