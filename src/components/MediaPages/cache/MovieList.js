'use client'

import { memo, Suspense } from 'react'
import PageContentAnimatePresence from '@components/HOC/PageContentAnimatePresence'
import MediaPoster from '@components/MediaPoster'
import { CaptionSVG } from '@components/SVGIcons'
import { TotalRuntime } from '@components/watched'
import Link from 'next/link'
import SkeletonCard from '@components/SkeletonCard'
import Loading from '@src/app/loading'
import { useMediaUrlParams } from '@src/utils/mediaListUtils/urlParamManager'
import { ShareIcon } from '@heroicons/react/20/solid'

/**
 * Extracts and sorts unique genres from a movie list
 * @param {Array} movieList - List of movies with metadata.genres
 * @returns {Array} - Sorted list of unique genre names
 */
const extractGenresFromMovies = (movieList) => {
  const genres = new Set();
  
  movieList.forEach(movie => {
    if (movie.metadata?.genres) {
      movie.metadata.genres.forEach(genre => {
        if (genre && genre.name) {
          genres.add(genre.name);
        }
      });
    }
  });
  
  return Array.from(genres).sort();
};

const variants = {
  hidden: { opacity: 0, x: 0, y: -20 },
  enter: { opacity: 1, x: 0, y: 0 },
}
const variants_height = {
  hidden: { opacity: 0 },
  enter: { opacity: 1 },
}

// Number of movies to show per page
const ITEMS_PER_PAGE = 20

// Memoized individual movie card component to prevent unnecessary rerenders
const MovieCard = memo(({ movie, index }) => {
  return (
    <PageContentAnimatePresence
      _key={movie.title + '-AnimationCont'}
      variants={variants}
      transition={{
        type: 'linear',
        duration: 0.4,
      }}
    >
      <Link href={`movie/${encodeURIComponent(movie.title)}`} className="group">
        <div className="relative block w-auto mx-auto overflow-hidden rounded-lg focus-within:ring-2 focus-within:ring-indigo-500 focus-within:ring-offset-2 focus-within:ring-offset-gray-100 ">
          <Suspense fallback={<SkeletonCard key={index} heightClass={'h-[582px]'} imageOnly />}><MediaPoster movie={movie} /></Suspense>
          <button type="button" className="absolute inset-0 focus:outline-none">
            <span className="sr-only">View details for {movie.title}</span>
          </button>
        </div>
        <p className="pointer-events-none mt-2 block text-sm font-medium text-gray-200 text-center">
          <TotalRuntime
            length={movie.metadata?.runtime ? movie.metadata.runtime * 60000 : 0}
            metadata={movie.metadata}
            videoURL={movie.videoURL}
          />
        </p>
        {movie.metadata?.release_date ? (
          <PageContentAnimatePresence
            _key={index + '-Metadata2'}
            variants={variants_height}
            transition={{ type: 'linear', delay: 0.21, duration: 2 }}
          >
            <p className="pointer-events-none mt-2 block text-sm font-medium text-gray-200 text-center">
              {typeof movie.metadata.release_date.toLocaleDateString === 'function'
                ? movie.metadata.release_date.toLocaleDateString()
                : String(movie.metadata.release_date)}
            </p>
          </PageContentAnimatePresence>
        ) : null}
        <PageContentAnimatePresence
          _key={index + '-Metadata3'}
          variants={variants_height}
          transition={{ type: 'linear', delay: 0.75, duration: 2 }}
        >
          <span className="pointer-events-none mt-2 block truncate text-sm font-medium text-white">
            <span className="underline">{movie.title}</span>{' '}
            {movie?.captionURLs ? <CaptionSVG /> : ''}
          </span>
        </PageContentAnimatePresence>
        {movie.metadata?.overview ? (
          <PageContentAnimatePresence
            _key={index + '-Metadata4'}
            variants={variants_height}
            transition={{ type: 'linear', delay: 0.75, duration: 2 }}
          >
            <p className="pointer-events-none mt-2 block text-sm font-medium text-gray-100">
              {movie.metadata.overview}
            </p>
          </PageContentAnimatePresence>
        ) : null}
      </Link>
    </PageContentAnimatePresence>
  );
});

// Set display name for debugging
MovieCard.displayName = 'MovieCard';

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

const MovieList = ({ movieList = [] }) => {
  // Use our custom hook to manage URL params and router state
  // This isolates router code to prevent waterfall re-renders
  const {
    sortOrder,
    selectedGenres,
    availableGenres,
    selectedHdrTypes,
    availableHdrTypes,
    currentPage,
    isPending,
    totalPages,
    filteredAndSortedMedia: filteredAndSortedMovies,
    currentItems: currentMovies,
    
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
  } = useMediaUrlParams(movieList, extractGenresFromMovies, ITEMS_PER_PAGE);

  return (
    <>
      {/* Sorting and filtering controls */}
      <li className="col-span-full mb-6 border-b border-gray-700 pb-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <label htmlFor="sort-order" className="block text-sm font-medium text-gray-300 mb-1">
              Sort by Release Date:
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
                  Showing {filteredAndSortedMovies.length} movies with selected filters
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
                Showing {totalPages > 0 ? `${currentPage} of ${totalPages}` : '0'} pages ({filteredAndSortedMovies.length} movies)
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

      {/* Display filtered and sorted movies */}
      {currentMovies.length === 0 ? (
        <li className="col-span-full">
          <p className="text-center text-gray-400 py-10">
            No movies found with the selected filters. Try adjusting your filter criteria.
          </p>
        </li>
      ) : (
        currentMovies.map((movie, index) => (
          <li key={movie.title + '-' + index} className="relative min-w-[250px] max-w-sm">
            {/* Use the memoized MovieCard component */}
            <MovieCard movie={movie} index={index} />
          </li>
        ))
      )}
    </>
  )
}

export default memo(MovieList)
