// Phase 1: Data Fetching Optimization with Vercel Best Practices
// Removed 'force-dynamic' to enable ISR caching
// Added React cache() for per-request deduplication
// Using centralized cacheLife profiles from next.config.js
// Converted to parallel Promise.all() fetching

import UnauthenticatedPage from '@components/system/UnauthenticatedPage'
import { withApprovedUser } from '@components/HOC/ApprovedUser'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getSession } from '@src/lib/cachedAuth'
import { AuthGuard } from '@components/MediaPages/DynamicPage'
import { getCachedCollectionDetails } from './cachedFetchers'

// *** VERCEL BEST PRACTICE: Cache Components Compatibility ***
// Using centralized cacheLife profiles from next.config.js (cacheComponents: true)
//
// React.cache() fetchers (getCachedCollectionDetails, getCachedOwnedMovies,
// getCachedEnhancedCollectionDetails) live in ./cachedFetchers because
// page.js may only export the default component plus a fixed set of
// metadata/config helpers — arbitrary exports fail Next.js page-type
// validation under webpack.

// *** VERCEL BEST PRACTICE: server-cache-react ***
// Use cached fetcher to eliminate duplicate API calls between generateMetadata and page component
export async function generateMetadata(props, parent) {
  const params = await props.params;
  const collectionId = params?.collectionId;
  
  // Check if user is authenticated before fetching collection data
  const session = await getSession();

  let title = (await parent).title.absolute;
  let description = (await parent).description;
  let poster = `/sorry-image-not-available.jpg`;

  // Only fetch collection details if user is authenticated
  if (collectionId && session?.user) {
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
  } else if (collectionId && !session?.user) {
    // Unauthenticated user - use generic metadata
    title = `Movie Collection - Sign in to view`;
    description = `Sign in to browse this movie collection.`;
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
  const session = await getSession()
  const _params = await params;
  const collectionId = _params?.collectionId;

  // Validate collection ID
  if (!collectionId || isNaN(collectionId)) {
    redirect('/list/movie');
  }

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
    <AuthGuard
      session={session}
      callbackUrl={`/list/collection/${collectionId}`}
      variant="skeleton"
      description="Sign in to browse movie collections and see what's available in the library."
    >
      {session?.user && (
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
      )}
    </AuthGuard>
  );
}

export default withApprovedUser(CollectionPage);