// TVShowSeasonsList.js
import { getFlatRequestedMedia } from '@src/utils/flatDatabaseUtils';
import Link from 'next/link';
import { auth } from '../../lib/auth';
import UnauthenticatedPage from '@components/system/UnauthenticatedPage';
import SkeletonCard from '@components/SkeletonCard';
import SignOutButton from '@components/SignOutButton';
import Detailed from '@components/Poster/Detailed';
import SyncClientWithServerWatched from '@components/SyncClientWithServerWatched';
import { fetchMetadataMultiServer } from '@src/utils/admin_utils';
import { getResolutionLabel } from '@src/utils';
import { classNames } from '@src/utils';
import SeasonItem from './Item/SeasonItem';
export const dynamic = 'force-dynamic';

const variants = {
  hidden: { opacity: 0, x: 0, y: -20 },
  enter: { opacity: 1, x: 0, y: 0 },
};

export default async function TVShowSeasonsList({ showTitle }) {
  const session = await auth();

  if (!session || !session.user) {
    // User is not authenticated
    return (
      <UnauthenticatedPage callbackUrl={`/list/tv/${showTitle}`}>
        <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl pb-8 xl:pb-0 px-4 xl:px-0">
          Please Sign in first
        </h2>
        <div className="border border-white border-opacity-30 rounded-lg p-3 overflow-hidden skeleton-container">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 overflow-hidden">
            <SkeletonCard />
            <SkeletonCard className="hidden md:block" />
            <SkeletonCard className="hidden lg:block" />
          </div>
        </div>
      </UnauthenticatedPage>
    );
  }

  const {
    user: { name, email },
  } = session;

  // Fetch the TV show and its seasons from flat database
  const tvShow = await getFlatRequestedMedia({
    type: 'tv',
    title: decodeURIComponent(showTitle)
  });

  if (!tvShow) {
    // TV show not found
    return (
      <div className="flex min-h-screen flex-col items-center justify-between xl:p-24">
        <div>
          <SkeletonCard />
          <h2 className="text-center mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl pb-8 xl:pb-0 px-4 xl:px-0 mt-4">
            `{decodeURIComponent(showTitle)}`
          </h2>
          <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl pb-8 xl:pb-0 px-4 xl:px-0 mt-4">
            We don't have that one
          </h2>
          <div className="flex flex-row gap-x-4 mt-4 justify-center">
            <Link href="/list/tv" className="self-center">
              <button
                type="button"
                className="flex flex-row gap-x-2 rounded bg-indigo-600 px-2 py-1 text-base font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-6 h-6"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
                  />
                </svg>
                Go Back
              </button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Fetch posterBlurhash if available
  if (tvShow.posterBlurhash) {
    tvShow.posterBlurhash = await fetchMetadataMultiServer(
      tvShow.posterBlurhashSource,
      tvShow.posterBlurhash,
      'blurhash',
      'tv',
      showTitle
    );
  }

  // Process all seasons: fetch blurhash and compute flags
  // Note: getFlatRequestedMedia already processes the blurhashes
  const processedSeasons = await Promise.all(
    tvShow.seasons.map(async (season) => {
      // For flat database, we might need to handle different field names
      if (season.posterBlurhash) {
        // Use the appropriate field name based on what's available
        const blurhashSource = season.posterBlurhashSource;
        const blurhashValue = season.posterBlurhash;
        
        if (blurhashValue && blurhashSource) {
          season.posterBlurhash = await fetchMetadataMultiServer(
            blurhashSource,
            blurhashValue,
            'blurhash',
            'tv',
            showTitle
          );
        }
      }

      // Check all episodes for HDR and 4k
      const episodes = season.episodes || [];

      const has4k = episodes.some(
        (episode) => getResolutionLabel(episode?.dimensions).is4k
      );

      const hasHDR = episodes.some((episode) => episode?.hdr);

      const hasHDR10 = episodes.some((episode) => episode?.hdr === 'HDR10');

      return { 
        ...season, 
        has4k, 
        hasHDR, 
        hasHDR10,
        // Ensure field naming is consistent with what the component expects
        posterURL: season.posterURL || season.season_poster
      };
    })
  );

  // Compute overall flags for 4K and HDR
  const overallHas4k = processedSeasons.some((season) => season.has4k);
  const overallHasHDR = processedSeasons.some((season) => season.hasHDR);
  const overallHasHDR10 = processedSeasons.some((season) => season.hasHDR10);

  // Calculate total episodes
  const totalEpisodes = processedSeasons.reduce((total, season) => {
    return total + (season.episodes ? season.episodes.length : 0);
  }, 0);

  return (
    <div className="flex min-h-screen flex-col items-center justify-between xl:p-24">
      <SyncClientWithServerWatched />
      <ul className="grid grid-cols-1 gap-x-4 gap-y-8 sm:gap-x-6 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-6 xl:gap-x-2 mt-32">
        {/* Summary Poster */}
        <li className="col-span-1 sm:col-span-3 xl:col-span-2 lg:row-span-3">
          <Detailed
            tvShow={tvShow}
            totalEpisodes={totalEpisodes}
            overallHas4k={overallHas4k}
            overallHasHDR={overallHasHDR}
            overallHasHDR10={overallHasHDR10}
          />
          <div className="flex flex-row gap-x-4 mt-4 justify-center">
            <Link href="/list/tv" className="self-center">
              <button
                type="button"
                className="flex flex-row gap-x-2 rounded bg-indigo-600 px-2 py-1 text-base font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-6 h-6"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
                  />
                </svg>
                Go Back
              </button>
            </Link>
            <SignOutButton
              className="self-center bg-gray-600 hover:bg-gray-500 focus-visible:outline-gray-600"
              signoutProps={{ callbackUrl: '/' }}
            />
          </div>
        </li>
        {/* Seasons List */}
        {processedSeasons.map((season) => (
          <SeasonItem key={season.seasonNumber} season={season} showTitle={showTitle} />
        ))}
      </ul>
    </div>
  );
}
