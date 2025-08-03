const dynamic = 'force-dynamic'
import { auth } from '../../../../../lib/auth'
import UnauthenticatedPage from '@components/system/UnauthenticatedPage'
import { withApprovedUser } from '@components/HOC/ApprovedUser'
import { Suspense } from 'react'
import Loading from '@src/app/loading'
import { getFlatMoviesByCollectionId, mergeCollectionWithOwnership } from '@src/utils/flatDatabaseUtils'
import { getCollectionDetails } from '@src/utils/tmdb/client'
import { redirect } from 'next/navigation'
import CollectionPageComponent from '@components/MediaPages/CollectionPageComponent'

export async function generateMetadata(props, parent) {
  const params = await props.params;
  const collectionId = params?.collectionId;

  let title = (await parent).title.absolute;
  let description = (await parent).description;
  let poster = `/sorry-image-not-available.jpg`;

  if (collectionId) {
    try {
      // Get collection data for metadata
      const tmdbCollection = await getCollectionDetails(collectionId);
      
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

  try {
    // Always fetch owned movies from local database first
    const ownedMovies = await getFlatMoviesByCollectionId(collectionId);
    
    // Try to fetch TMDB collection data, but gracefully handle failures
    let tmdbCollection = null;
    try {
      console.log(`Attempting to fetch TMDB collection data for collection ${collectionId}...`);
      tmdbCollection = await getCollectionDetails(collectionId);
      console.log(`Successfully fetched TMDB collection data for ${collectionId}`);
    } catch (tmdbError) {
      console.error(`TMDB collection data unavailable for collection ${collectionId}:`, tmdbError);
      console.error('Failed TMDB URL:', `/api/authenticated/tmdb/collection/${collectionId}`);
      // TMDB might not be configured - continue with local data only
    }

    // If we have no local movies and no TMDB data, redirect
    if (!ownedMovies?.length && !tmdbCollection) {
      console.warn(`No data found for collection ${collectionId} - redirecting to movie list`);
      redirect('/list/movie');
    }

    // Create collection data with what we have
    let collectionWithOwnership;
    
    if (tmdbCollection) {
      // Full experience with TMDB data
      collectionWithOwnership = mergeCollectionWithOwnership(ownedMovies, tmdbCollection);
      console.log(`Collection ${collectionId}: Merged ${ownedMovies.length} owned movies with TMDB data`);
    } else {
      // Local-only experience when TMDB is unavailable
      console.warn(`Collection ${collectionId}: Using local-only data (${ownedMovies.length} movies)`);
      collectionWithOwnership = {
        id: collectionId,
        name: `Movie Collection ${collectionId}`,
        overview: `Collection of ${ownedMovies.length} movie${ownedMovies.length !== 1 ? 's' : ''} from your library.`,
        parts: ownedMovies,
        ownershipStats: {
          owned: ownedMovies.length,
          total: ownedMovies.length,
          percentage: 100
        },
        backdrop: ownedMovies[0]?.backdrop || null,
        posterURL: ownedMovies[0]?.posterURL || null
      };
    }

    return (
      <Suspense fallback={<Loading />}>
        <CollectionPageComponent
          collection={collectionWithOwnership}
          collectionId={collectionId}
          tmdbUnavailable={!tmdbCollection}
        />
      </Suspense>
    );

  } catch (error) {
    console.error(`Error loading collection page for collection ${collectionId}:`, error);
    console.error('Collection page error details:', {
      collectionId,
      errorMessage: error.message,
      errorStack: error.stack
    });
    
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white mb-4">Collection Error</h1>
          <p className="text-gray-300 mb-6">
            There was an error loading collection {collectionId}. This might be due to TMDB configuration issues or network problems.
          </p>
          <div className="text-sm text-gray-400 mb-6">
            Check the console for detailed error information including the failing URL.
          </div>
          <a
            href="/list/movie"
            className="inline-flex items-center px-4 py-2 border border-transparent text-base font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            ← Back to Movies List
          </a>
        </div>
      </div>
    );
  }
}

export default withApprovedUser(CollectionPage);