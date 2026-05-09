// Cached collection fetchers for the [collectionId] route.
//
// Hoisted out of page.js because Next.js App Router page files may only export
// the default component plus a fixed set of metadata/config exports — arbitrary
// helpers like these are rejected by the page-type validator at build time.
//
// React.cache() deduplicates calls per request, so generateMetadata in page.js
// and the various server components in ServerComponents.js both call these
// once and share the resolved value. That deduplication relies on every caller
// importing from the SAME module URL, which is why these three functions stay
// colocated in one file.

import { cache } from 'react'
import { getCollectionDetails } from '@src/utils/tmdb/client'
import { getFlatMoviesByCollectionId } from '@src/utils/flatDatabaseUtils'

export const getCachedCollectionDetails = cache(async (collectionId) => {
  console.log(`[CACHE] Fetching collection details for ${collectionId}`)
  return getCollectionDetails(collectionId)
})

export const getCachedOwnedMovies = cache(async (collectionId) => {
  console.log(`[CACHE] Fetching owned movies for collection ${collectionId}`)
  return getFlatMoviesByCollectionId(collectionId)
})

export const getCachedEnhancedCollectionDetails = cache(async (collectionId) => {
  console.log(`[CACHE] Fetching enhanced collection details for ${collectionId}`)

  try {
    // Use the existing enhanced endpoint that already aggregates director data.
    const enhancedData = await getCollectionDetails(collectionId, { enhanced: true })
    console.log(`[CACHE] Enhanced collection data retrieved for ${collectionId}`, {
      hasAggregatedData: !!enhancedData?.aggregatedData,
      topDirectorsCount: enhancedData?.aggregatedData?.topDirectors?.length || 0,
      topCastCount: enhancedData?.aggregatedData?.topCast?.length || 0,
    })

    return enhancedData
  } catch (error) {
    console.error(`Error fetching enhanced collection data for ${collectionId}:`, error)
    // Fallback to regular collection details
    console.log(`[CACHE] Falling back to regular collection details for ${collectionId}`)
    return getCollectionDetails(collectionId)
  }
})
