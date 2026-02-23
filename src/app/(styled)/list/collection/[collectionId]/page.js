// Phase 1: Data Fetching Optimization with Vercel Best Practices
// Removed 'force-dynamic' to enable ISR caching
// Added React cache() for per-request deduplication
// Using centralized cacheLife profiles from next.config.js
// Converted to parallel Promise.all() fetching

import { cache } from 'react'
import { auth } from '../../../../../lib/auth'
import UnauthenticatedPage from '@components/system/UnauthenticatedPage'
import { withApprovedUser } from '@components/HOC/ApprovedUser'
import { Suspense } from 'react'
import Loading from '@src/app/loading'
import { getFlatMoviesByCollectionId, mergeCollectionWithOwnership } from '@src/utils/flatDatabaseUtils'
import { getCollectionDetails } from '@src/utils/tmdb/client'
import { redirect } from 'next/navigation'
import CollectionPageComponent from '@components/MediaPages/CollectionPageComponent'
import Link from 'next/link'

// *** VERCEL BEST PRACTICE: Cache Components Compatibility ***
// Using centralized cacheLife profiles from next.config.js (cacheComponents: true)

// *** VERCEL BEST PRACTICE: server-cache-react ***
// Create cached fetcher using React.cache() for per-request deduplication
// This eliminates duplicate API calls between generateMetadata and page component
export const getCachedCollectionDetails = cache(async (collectionId) => {
  console.log(`[CACHE] Fetching collection details for ${collectionId}`)
  return getCollectionDetails(collectionId)
})

// *** VERCEL BEST PRACTICE: server-cache-react ***  
// Create cached fetcher for owned movies to leverage React.cache() deduplication
export const getCachedOwnedMovies = cache(async (collectionId) => {
  console.log(`[CACHE] Fetching owned movies for collection ${collectionId}`)
  return getFlatMoviesByCollectionId(collectionId)
})

// *** OPTIMIZED: Cached fetcher for enhanced collection data with aggregated crew info ***
export const getCachedEnhancedCollectionDetails = cache(async (collectionId) => {
  console.log(`[CACHE] Fetching enhanced collection details for ${collectionId}`)
  
  try {
    // Use the existing enhanced endpoint that already aggregates director data!
    const enhancedData = await getCollectionDetails(collectionId, { enhanced: true })
    console.log(`[CACHE] Enhanced collection data retrieved for ${collectionId}`, {
      hasAggregatedData: !!enhancedData?.aggregatedData,
      topDirectorsCount: enhancedData?.aggregatedData?.topDirectors?.length || 0,
      topCastCount: enhancedData?.aggregatedData?.topCast?.length || 0
    })
    
    return enhancedData
  } catch (error) {
    console.error(`Error fetching enhanced collection data for ${collectionId}:`, error)
    // Fallback to regular collection details
    console.log(`[CACHE] Falling back to regular collection details for ${collectionId}`)
    return getCollectionDetails(collectionId)
  }
})

// *** VERCEL BEST PRACTICE: server-cache-react ***
// Use cached fetcher to eliminate duplicate API calls between generateMetadata and page component
export async function generateMetadata(props, parent) {
  const params = await props.params;
  const collectionId = params?.collectionId;

  let title = (await parent).title.absolute;
  let description = (await parent).description;
  let poster = `/sorry-image-not-available.jpg`;

  if (collectionId) {
    try {
      // *** OPTIMIZATION: Use cached fetcher instead of direct API call ***
      // This call will be deduplicated with the page component call automatically by React.cache()
      console.log(`[METADATA] Using cached collection details for ${collectionId}`)
      const tmdbCollection = await getCachedCollectionDetails(collectionId);
      
      if (tmdbCollection) {
        title = `${tmdbCollection.name} - Collection`;
        description = tmdbCollection.overview || `Browse the ${tmdbCollection.name} movie collection.`;
        poster = tmdbCollection.poster_path
          ? `https://image.tmdb.org/t/p/w780${tmdbCollection.poster_path}`
          : poster;
      }
    } catch (error) {
      console.error(`Error generating collection metadata for collection ${collectionId}:`, error);
      console.error('TMDB Collection URL that failed:', `/api/authenticated/tmdb/collection/${collectionId}`);
      // Use default metadata when TMDB is unavailable
      title = `Movie Collection ${collectionId}`;
      description = `Browse movies in this collection.`;
    }
  }

  return {
    title,
    description,
    openGraph: {
      images: [poster],
    },
  };
}

async function CollectionPage({ params, searchParams }) {
  const session = await auth();
  const _params = await params;
  const collectionId = _params?.collectionId;

  // Handle unauthenticated users
  if (!session || !session.user) {
    return (
      <UnauthenticatedPage callbackUrl={`/list/collection/${collectionId}`}>
        <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl pb-8 xl:pb-0 px-4 xl:px-0">
          Please Sign in first
        </h2>
        <div className="text-center text-gray-300 mt-4">
          Sign in to browse movie collections and see what's available in the library.
        </div>
      </UnauthenticatedPage>
    );
  }

  // Validate collection ID
  if (!collectionId || isNaN(collectionId)) {
    redirect('/list/movie');
  }

  // *** CRITICAL: TRUE STREAMING ARCHITECTURE ***
  // Return page shell IMMEDIATELY - no awaiting data!
  // Each Suspense boundary will fetch its own data independently
  console.log(`[STREAMING] Rendering instant shell for collection ${collectionId}`)
  
  // Import skeletons and components
  const {
    CollectionHeaderSkeleton,
    CollectionSummarySkeleton,
    FilterControlsSkeleton,
    MovieGridSkeleton,
    FeaturedContributorsSkeleton
  } = await import('@components/MediaPages/Collection/Skeletons')
  
  const {
    CollectionHeaderServerComponent,
    CollectionSummaryStripServerComponent,
    FeaturedContributorsServerComponent,
    CollectionMoviesServerComponent
  } = await import('@components/MediaPages/Collection/ServerComponents')
  
  const { CollectionSectionErrorBoundary } = await import('@components/MediaPages/Collection/ClientErrorBoundary')

  return (
    <div className="min-h-screen bg-gray-950">
      {/* *** STREAM 1: Header - fetches its own data independently *** */}
      <Suspense fallback={<CollectionHeaderSkeleton />}>
        <CollectionSectionErrorBoundary
          fallback={<CollectionHeaderSkeleton />}
          sectionName="Collection Header"
        >
          <CollectionHeaderServerComponent collectionId={collectionId} />
        </CollectionSectionErrorBoundary>
      </Suspense>

      {/* *** STREAM 2: Collection Summary Strip - rich metadata like original *** */}
      <Suspense fallback={<CollectionSummarySkeleton />}>
        <CollectionSectionErrorBoundary
          fallback={<CollectionSummarySkeleton />}
          sectionName="Collection Metadata"
        >
          <CollectionSummaryStripServerComponent collectionId={collectionId} />
        </CollectionSectionErrorBoundary>
      </Suspense>

      {/* *** STREAM 3: Featured Contributors - appears BEFORE movies like original *** */}
      <Suspense fallback={<FeaturedContributorsSkeleton />}>
        <CollectionSectionErrorBoundary
          fallback={null}
          sectionName="Featured Contributors"
        >
          <FeaturedContributorsServerComponent collectionId={collectionId} />
        </CollectionSectionErrorBoundary>
      </Suspense>

      {/* *** STREAM 4: Movies Grid - main content streams independently *** */}
      <Suspense fallback={
        <>
          <FilterControlsSkeleton />
          <div className="max-w-7xl mx-auto px-4 md:px-8 py-8">
            <MovieGridSkeleton count={12} />
          </div>
        </>
      }>
        <CollectionSectionErrorBoundary
          fallback={
            <div className="text-center py-16">
              <div className="text-red-400 text-lg">Error loading movies</div>
            </div>
          }
          sectionName="Movies Grid"
        >
          <CollectionMoviesServerComponent
            collectionId={collectionId}
            defaultFilter="all"
            defaultSort="release_date"
          />
        </CollectionSectionErrorBoundary>
      </Suspense>
    </div>
  );
}

export default withApprovedUser(CollectionPage);