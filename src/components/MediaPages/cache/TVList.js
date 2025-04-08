'use client'

import { memo, Suspense } from 'react'
import PageContentAnimatePresence from '@components/HOC/PageContentAnimatePresence'
import Detailed from '@components/Poster/Detailed'
import { ShareIcon } from '@heroicons/react/20/solid'
import Link from 'next/link'
import SkeletonCard from '@components/SkeletonCard'
import Loading from '@src/app/loading'
import { useMediaUrlParams } from '@src/utils/mediaListUtils/urlParamManager'

/**
 * Extracts and sorts unique genres from a TV show list
 * @param {Array} tvList - List of TV shows with metadata.genres
 * @returns {Array} - Sorted list of unique genre names
 */
const extractGenresFromTVShows = (tvList) => {
  const genres = new Set();
  
  tvList.forEach(tv => {
    if (tv.metadata?.genres) {
      tv.metadata.genres.forEach(genre => {
        if (genre && genre.name) {
          genres.add(genre.name);
        }
      });
    }
  });
  
  return Array.from(genres).sort();
};

/**
 * Extracts HDR types from TV shows by looking at nested episode data
 * @param {Array} tvList - List of TV shows with seasons and episodes
 * @returns {Array} - Sorted list of unique HDR types
 */
const extractHdrTypesFromTVShows = (tvList) => {
  const hdrTypes = new Set();
  
  tvList.forEach(tv => {
    // Check each season and its episodes for HDR information
    if (tv.seasons && Array.isArray(tv.seasons)) {
      tv.seasons.forEach(season => {
        if (season.episodes && Array.isArray(season.episodes)) {
          season.episodes.forEach(episode => {
            // If the episode has HDR and it's a string (e.g., "HDR10", "Dolby Vision")
            if (episode.hdr && typeof episode.hdr === 'string') {
              // Split HDR types if they contain commas (e.g., "HDR10, HLG")
              const hdrValues = episode.hdr.split(',').map(val => val.trim());
              hdrValues.forEach(val => {
                if (val) hdrTypes.add(val);
              });
            }
            // If it's just a boolean true, add a generic "HDR" type
            else if (episode.hdr === true) {
              hdrTypes.add('HDR');
            }
          });
        }
      });
    }
  });
  
  return Array.from(hdrTypes).sort();
};

const variants = {
  hidden: { opacity: 0, x: 0, y: -20 },
  enter: { opacity: 1, x: 0, y: 0 },
}
const variants_height = {
  hidden: { opacity: 0 },
  enter: { opacity: 1 },
}

// Number of TV shows to show per page
const ITEMS_PER_PAGE = 20

// Memoized individual TV show card component to prevent unnecessary rerenders
const TVCard = memo(({ tv, index }) => {
  return (
    <PageContentAnimatePresence
      _key={tv.title + '-AnimationCont'}
      variants={variants}
      transition={{
        type: 'linear',
        duration: 0.4,
      }}
    >
      <Link href={`/list/tv/${encodeURIComponent(tv.title)}`} className="group">
        <Suspense fallback={<SkeletonCard key={index} heightClass={'h-[582px]'} imageOnly />}>
          <Detailed tvShow={tv} check4kandHDR={true} />
        </Suspense>
      </Link>
    </PageContentAnimatePresence>
  );
});

// Set display name for debugging
TVCard.displayName = 'TVCard';

/**
 * Memoized filter button component that only re-renders when necessary
 * - Only re-renders when isSelected changes or when text changes
 */
const FilterButton = memo(({ 
  text, 
  isSelected, 
  onToggle, 
  isPending 
}) => {
  return (
    <button
      onClick={() => onToggle(text)}
      disabled={isPending}
      className={`text-xs rounded-full px-3 py-1 ${
        isSelected
          ? 'bg-indigo-600 text-white'
          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
      } ${isPending ? 'delay-300 opacity-50' : ''}`}
    >
      {text}
    </button>
  );
}, (prevProps, nextProps) => {
  // Custom comparison function to prevent unnecessary re-renders
  // Only re-render if selection state changes or text changes
  return prevProps.isSelected === nextProps.isSelected && 
         prevProps.text === nextProps.text &&
         prevProps.isPending === nextProps.isPending;
});

// Set display name for debugging
FilterButton.displayName = 'FilterButton';

/**
 * Memoized genre button component - uses FilterButton component
 */
const GenreButton = memo(({ genre, isSelected, onToggle, isPending }) => {
  return (
    <FilterButton
      text={genre}
      isSelected={isSelected}
      onToggle={onToggle}
      isPending={isPending}
    />
  );
});

// Set display name for debugging
GenreButton.displayName = 'GenreButton';

/**
 * Memoized HDR type button component - uses FilterButton component
 */
const HdrTypeButton = memo(({ hdrType, isSelected, onToggle, isPending }) => {
  return (
    <FilterButton
      text={hdrType}
      isSelected={isSelected}
      onToggle={onToggle}
      isPending={isPending}
    />
  );
});

// Set display name for debugging
HdrTypeButton.displayName = 'HdrTypeButton';

const TVList = ({ tvList = [] }) => {
  // Use our custom hook to manage URL params and router state
  const {
    sortOrder,
    selectedGenres,
    availableGenres,
    selectedHdrTypes,
    availableHdrTypes,
    currentPage,
    isPending,
    totalPages,
    filteredAndSortedMedia: filteredAndSortedTVShows,
    currentItems: currentTVShows,
    
    // Functions
    handleGenreToggle,
    handleHdrTypeToggle,
    handleSortOrderChange,
    goToNextPage,
    goToPrevPage,
    goToPage,
    copyShareLink,
    handleClearFilters,
    setAvailableGenres
  } = useMediaUrlParams(
    tvList, 
    extractGenresFromTVShows, 
    ITEMS_PER_PAGE,
    extractHdrTypesFromTVShows
  );

  return (
    <>
      {/* Sorting and filtering controls */}
      <li className="col-span-full mb-6 border-b border-gray-700 pb-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <label htmlFor="sort-order" className="block text-sm font-medium text-gray-300 mb-1">
              Sort by Last Air Date:
            </label>
            <select
              id="sort-order"
              value={sortOrder}
              onChange={(e) => handleSortOrderChange(e.target.value)}
              className="rounded bg-gray-800 text-white border border-gray-600 px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500"
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
            </select>
          </div>
          
          <div className="flex flex-col gap-3 w-full md:w-auto">
            {/* Genre filters */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Filter by Genre:
              </label>
              <div className="flex flex-wrap gap-2 max-w-3xl">
                {availableGenres.length > 0 ? availableGenres.map(genre => (
                  <GenreButton
                    key={genre}
                    genre={genre}
                    isSelected={selectedGenres.includes(genre)}
                    onToggle={handleGenreToggle}
                    isPending={isPending}
                  />
                )) : (
                  <>
                  {/* Genre filter buttons skeleton */}
                  <div className="w-full md:w-auto">
                    <div className="flex flex-wrap gap-2 max-w-3xl">
                      {Array.from({ length: 8 }, (_, i) => (
                        <div key={`genre-skeleton-${i}`} className="h-6 bg-gray-700 animate-pulse rounded-full" style={{ width: `68px` }}></div>
                      ))}
                    </div>
                  </div>
                  </>
                )}
              </div>
            </div>
            
            {/* HDR filters */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Filter by HDR:
              </label>
              <div className="flex flex-wrap gap-2 max-w-3xl">
                {availableHdrTypes.length > 0 ? availableHdrTypes.map(hdrType => (
                  <HdrTypeButton
                    key={hdrType}
                    hdrType={hdrType}
                    isSelected={selectedHdrTypes.includes(hdrType)}
                    onToggle={handleHdrTypeToggle}
                    isPending={isPending}
                  />
                )) : (
                  <div className="text-sm text-gray-400">No HDR content available</div>
                )}
              </div>
            </div>
          </div>
        </div>
        
        {/* Show filter status, clear button, and share button */}
        <div className="mt-3 flex items-center justify-between">
          <div className="flex flex-row gap-2 items-center">
            {(selectedGenres.length > 0 || selectedHdrTypes.length > 0) ? (
              <div className="flex items-center">
                <span className="text-sm text-gray-200">
                  Showing {filteredAndSortedTVShows.length} TV shows with selected filters
                  {selectedGenres.length > 0 && ` (Genres: ${selectedGenres.join(', ')})`}
                  {selectedHdrTypes.length > 0 && ` (HDR: ${selectedHdrTypes.join(', ')})`}
                </span>
                <button
                  onClick={handleClearFilters}
                  disabled={isPending}
                  className={`ml-3 text-xs text-indigo-200 hover:text-indigo-300 ${isPending ? 'delay-300 opacity-50' : ''}`}
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <span className="text-sm text-gray-200">
                Showing {totalPages > 0 ? `${currentPage} of ${totalPages}` : '0'} pages ({filteredAndSortedTVShows.length} TV shows)
              </span>
            )}
            {/* Share button - only show when filters or non-default sort is applied */}
            {(selectedGenres.length > 0 || selectedHdrTypes.length > 0 || sortOrder !== 'newest' || currentPage > 1) && (
              <button
                onClick={copyShareLink}
                className="text-sm text-indigo-200 hover:text-indigo-300 flex items-center gap-1"
                title="Copy shareable link with current filters"
              >
                <ShareIcon className='w-4 h-4' />
                Share View
              </button>
            )}
            {/* Global loading indicator for the entire list - shown when content is changing */}
            {isPending && (
              <Loading fullscreenClasses={false} containerClassnames='inline-block' padding="p-0" size="w-6 h-6" />
            )}
          </div>
          
          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="flex items-center space-x-2">
              <button
                onClick={goToPrevPage}
                disabled={currentPage === 1 || isPending}
                className={`px-2 py-1 rounded bg-gray-800 text-white ${currentPage === 1 || isPending ? 'delay-300 opacity-50 cursor-not-allowed' : 'hover:bg-gray-700'}`}
              >
                &lt;
              </button>
              
              {/* Show page numbers with ellipsis for large page counts */}
              {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
                // Logic to show current page and surrounding pages
                let pageNum;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }
                
                return (
                  <button
                    key={pageNum}
                    onClick={() => goToPage(pageNum)}
                    disabled={isPending}
                    className={`w-8 h-8 rounded ${
                      currentPage === pageNum 
                        ? 'bg-indigo-600 text-white' 
                        : 'bg-gray-800 text-white hover:bg-gray-700'
                    } ${isPending ? 'opacity-50' : ''}`}
                  >
                    {pageNum}
                  </button>
                );
              })}
              
              <button
                onClick={goToNextPage}
                disabled={currentPage === totalPages || isPending}
                className={`px-2 py-1 rounded bg-gray-800 text-white ${currentPage === totalPages || isPending ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-700'}`}
              >
                &gt;
              </button>
            </div>
          )}
        </div>
      </li>

      {/* Display filtered and sorted TV shows */}
      {currentTVShows.length === 0 ? (
        <li className="col-span-full">
          <p className="text-center text-gray-400 py-10">
            No TV shows found with the selected filters. Try adjusting your filter criteria.
          </p>
        </li>
      ) : (
        currentTVShows.map((tv, index) => (
          <li key={tv.title + '-' + index} className="relative min-w-[250px] max-w-sm">
            {/* Use the memoized TVCard component */}
            <TVCard tv={tv} index={index} />
          </li>
        ))
      )}
    </>
  )
}

export default memo(TVList)
