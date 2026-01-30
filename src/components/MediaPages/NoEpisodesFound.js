'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import PageContentAnimatePresence from '@components/HOC/PageContentAnimatePresence';
import SyncClientWithServerWatched from '@components/SyncClientWithServerWatched';

const variants = {
  hidden: { opacity: 0, x: 0, y: -20 },
  enter: { opacity: 1, x: 0, y: 0 },
};

export default function NoEpisodesFound({ onRetry, showTitle, seasonNumber, season = {} }) {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  
  // Use passed season data or create placeholders
  const seasonMetadata = season?.metadata ?? {};
  
  const handleRetry = async () => {
    setIsLoading(true);
    try {
      const result = await onRetry({ showTitle, seasonNumber });
      
      // Check if refresh was successful and episodes were found
      if (result.success && result.data && result.data.episodes && result.data.episodes.length > 0) {
        // Episodes found - refresh the page to show the updated content
        router.refresh();
        // No need to reset loading state as component will remount with episodes
      } else {
        // No episodes were found despite successful refresh
        console.log('Refresh completed but no episodes were found');
        
        // Show a message to the user
        const message = document.getElementById('no-episodes-message');
        if (message) {
          message.textContent = 'No episodes found. Please try again later.';
          setTimeout(() => {
            if (message) message.textContent = 'No episodes found for this season';
          }, 3000);
        }
        
        setIsLoading(false); // Reset loading state to allow trying again
      }
    } catch (error) {
      console.error('Error refreshing episodes:', error);
      // Reset loading state on error so the user can try again
      setIsLoading(false);
    }
  };
  
  return (
    <div className="flex min-h-screen flex-col items-center justify-between xl:p-24 transition-opacity duration-300">
      <SyncClientWithServerWatched />
      <div className="h-auto flex items-center justify-center py-32 lg:py-0 px-4 xl:px-0 sm:mt-20">
        <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-x-4 gap-y-8 sm:gap-x-6 xl:gap-x-8">
          {/* Summary Poster - Left Column */}
          <li className="col-span-1 sm:col-span-2 xl:col-span-1 lg:row-span-3 text-center">
            {season?.posterURL ? (
              <Image
                src={season.posterURL}
                alt={`Season ${seasonNumber}`}
                className="max-w-full rounded-lg !mx-auto"
                width={300}
                height={450}
              />
            ) : (
              <div className="w-[300px] h-[450px] bg-gray-800 rounded-lg mx-auto flex items-center justify-center">
                <span className="text-gray-400">Poster Not Available</span>
              </div>
            )}
            <h2 className="mx-auto max-w-2xl text-2xl font-bold tracking-tight text-white sm:text-3xl pb-8 xl:pb-0 px-4 xl:px-0">
              Viewing Season {seasonNumber}
            </h2>
            {seasonMetadata?.airDate && (
              <div className="flex flex-row gap-x-4 justify-center">
                Originally Aired: {new Date(seasonMetadata.airDate).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </div>
            )}
            {(seasonMetadata?.overview && seasonMetadata.overview !== "") && (
              <div className="mt-2 text-center text-sm font-medium text-gray-300 group-hover:text-white pt-2 border-t border-solid border-t-[#c1c1c133]">
                {seasonMetadata.overview}
              </div>
            )}
            {(seasonMetadata?.vote_average || seasonMetadata.vote_average !== 0) && (
              <div className="flex flex-row gap-x-4 mt-4 justify-center items-center">
                <span className="text-yellow-400 font-bold">Popularity:</span>
                <div className="relative w-48 h-4 bg-gray-700 rounded-full">
                  <div
                    className="absolute top-0 left-0 h-full bg-yellow-400 rounded-full"
                    style={{ width: `${seasonMetadata.vote_average * 10}%` }}
                  ></div>
                </div>
                <span className="text-white font-bold">{seasonMetadata.vote_average} / 10</span>
              </div>
            )}
            <div className="flex flex-row gap-x-4 mt-4 justify-center">
              <Link href={`/list/tv/${encodeURIComponent(showTitle)}`} className="self-center">
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
          </li>
          
          {/* No Episodes Found - Right Area */}
          <li className="col-span-1 sm:col-span-2 xl:col-span-3 text-center">
            <PageContentAnimatePresence
              variants={variants}
              transition={{
                type: 'linear',
                duration: 0.45,
              }}
            >
              <div className="relative text-center h-full flex flex-col items-center justify-center">
                <div className="relative inline-block">
                  <Image
                    src="/emoji-movie-theatre.png"
                    alt="No episodes found"
                    className="mx-auto !w-auto h-[45vh] rounded-lg shadow-lg"
                    width={430}
                    height={520}
                  />
                  <div className="absolute inset-0 bg-black bg-opacity-50 rounded-lg"></div>
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                    <div id="no-episodes-message" className="text-white font-bold text-lg">
                      No episodes found for this season
                    </div>
                    <button
                      onClick={handleRetry}
                      disabled={isLoading}
                      className="flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-white transition hover:bg-indigo-500 disabled:opacity-50"
                    >
                      {isLoading ? (
                        <>
                          <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          <span>Refreshing...</span>
                        </>
                      ) : (
                        <>
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          <span>Try Again</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </PageContentAnimatePresence>
          </li>
        </ul>
      </div>
    </div>
  );
}
