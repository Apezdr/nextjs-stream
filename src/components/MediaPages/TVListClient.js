/**
 * TV List Client Component
 * 
 * Client-driven filtering pattern:
 * - Filter state lives entirely in client (single source of truth)
 * - URL seeds initial state on mount, then becomes write-only for sharing
 * - Data fetches based on client state, not URL
 * - RequestId guards prevent stale responses
 * 
 * This eliminates bidirectional sync races and provides smooth UX
 */

'use client'

import { memo, Suspense, useTransition, useCallback, useState, useEffect, useRef } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import PageContentAnimatePresence from '@components/HOC/PageContentAnimatePresence'
import Detailed from '@components/Poster/Detailed'
import { ShareIcon } from '@heroicons/react/20/solid'
import Link from 'next/link'
import SkeletonCard from '@components/SkeletonCard'
import Loading from '@src/app/loading'
import { getTVListData } from '@src/utils/actions/mediaListActions'

const variants = {
  hidden: { opacity: 0, x: 0, y: -20 },
  enter: { opacity: 1, x: 0, y: 0 },
}

// Memoized individual TV show card component
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
      <Link href={`/list/tv/${encodeURIComponent(tv.title)}`} className="group" scroll={true}>
        <Suspense fallback={<SkeletonCard key={index} heightClass={'h-[582px]'} imageOnly />}>
          <Detailed tvShow={tv} check4kandHDR={true} />
        </Suspense>
      </Link>
    </PageContentAnimatePresence>
  );
});

TVCard.displayName = 'TVCard';

// Memoized filter button component
const FilterButton = memo(({ 
  text, 
  isSelected, 
  onToggle
}) => {
  return (
    <button
      onClick={() => onToggle(text)}
      className={`text-xs rounded-full px-3 py-1 ${
        isSelected
          ? 'bg-indigo-600 text-white'
          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
      }`}
    >
      {text}
    </button>
  );
}, (prevProps, nextProps) => {
  return prevProps.isSelected === nextProps.isSelected && 
         prevProps.text === nextProps.text;
});

FilterButton.displayName = 'FilterButton';

// Memoized genre button
const GenreButton = memo(({ genre, isSelected, onToggle }) => {
  return (
    <FilterButton
      text={genre}
      isSelected={isSelected}
      onToggle={onToggle}
    />
  );
});

GenreButton.displayName = 'GenreButton';

// Memoized HDR type button
const HdrTypeButton = memo(({ hdrType, isSelected, onToggle }) => {
  return (
    <FilterButton
      text={hdrType}
      isSelected={isSelected}
      onToggle={onToggle}
    />
  );
});

HdrTypeButton.displayName = 'HdrTypeButton';

/**
 * TV List Client Component
 * 
 * Client is source of truth for filters, server is source of truth for data
 */
export default function TVListClient({ initialFilters, initialData }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const urlDebounceRef = useRef(null);
  const fetchDebounceRef = useRef(null);
  const requestIdRef = useRef(0);
  const isFirstRenderRef = useRef(true);
  
  // Client-owned filter state (single source of truth)
  const [filters, setFilters] = useState({
    sortOrder: initialFilters.sortOrder,
    genres: initialFilters.genres,
    hdrTypes: initialFilters.hdrTypes
  });
  const [page, setPage] = useState(initialFilters.page);
  
  // Data state (fetched based on filters + page)
  const [data, setData] = useState(initialData);
  
  /**
   * Fetch data whenever filters or page change (after initial load)
   * Debounced to prevent request pileup on rapid filter changes
   */
  useEffect(() => {
    // Skip only on the very first render (already have SSR data)
    // After first render, always fetch when filters/page change
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    
    // Clear any pending fetch
    if (fetchDebounceRef.current) {
      clearTimeout(fetchDebounceRef.current);
    }
    
    // Debounce fetch to prevent request pileup
    fetchDebounceRef.current = setTimeout(() => {
      // Assign request ID to detect stale responses
      const requestId = ++requestIdRef.current;
      
      startTransition(async () => {
        const nextData = await getTVListData({
          ...filters,
          page
        });
        
        // Only apply if this is still the latest request
        if (requestId === requestIdRef.current) {
          setData(nextData);
        }
      });
    }, 150); // Shorter debounce for data fetch
    
    return () => {
      if (fetchDebounceRef.current) {
        clearTimeout(fetchDebounceRef.current);
      }
    };
  }, [filters, page, initialFilters]);
  
  /**
   * Sync URL cosmetically for sharing (debounced, write-only)
   * Builds URL from scratch based on current filter state (not from searchParams)
   */
  useEffect(() => {
    // Clear existing timeout
    if (urlDebounceRef.current) {
      clearTimeout(urlDebounceRef.current);
    }
    
    // Debounce URL updates
    urlDebounceRef.current = setTimeout(() => {
      // Build params from scratch based on current filter state
      // This ensures URL always matches client state exactly
      const params = new URLSearchParams();
      
      // Add only non-default values
      if (filters.sortOrder !== 'newest') {
        params.set('sort', filters.sortOrder);
      }
      if (filters.genres.length > 0) {
        params.set('genres', filters.genres.join(','));
      }
      if (filters.hdrTypes.length > 0) {
        params.set('hdr', filters.hdrTypes.join(','));
      }
      if (page > 1) {
        params.set('page', page.toString());
      }
      
      const query = params.toString();
      const newUrl = query ? `${pathname}?${query}` : pathname;
      
      // Use window.history to update URL without triggering Next.js navigation
      // This prevents the double-fetch issue while keeping URL shareable
      window.history.replaceState(null, '', newUrl);
    }, 250);
    
    return () => {
      if (urlDebounceRef.current) {
        clearTimeout(urlDebounceRef.current);
      }
    };
  }, [filters, page, pathname, router]);
  
  const { items: currentTVShows, totalCount, totalPages, filterOptions } = data;
  const { availableGenres, availableHdrTypes } = filterOptions;
  
  // Filter handlers (update client state immediately)
  const handleGenreToggle = useCallback((genre) => {
    setFilters(prev => {
      const exists = prev.genres.includes(genre);
      const genres = exists
        ? prev.genres.filter(g => g !== genre)
        : [...prev.genres, genre];
      return { ...prev, genres };
    });
    setPage(1); // Reset to page 1
  }, []);
  
  const handleHdrTypeToggle = useCallback((hdrType) => {
    setFilters(prev => {
      const exists = prev.hdrTypes.includes(hdrType);
      const hdrTypes = exists
        ? prev.hdrTypes.filter(t => t !== hdrType)
        : [...prev.hdrTypes, hdrType];
      return { ...prev, hdrTypes };
    });
    setPage(1); // Reset to page 1
  }, []);
  
  const handleSortOrderChange = useCallback((newSortOrder) => {
    setFilters(prev => ({ ...prev, sortOrder: newSortOrder }));
    setPage(1); // Reset to page 1
  }, []);
  
  const handleClearFilters = useCallback(() => {
    setFilters(prev => ({ ...prev, genres: [], hdrTypes: [] }));
    setPage(1);
  }, []);
  
  // Pagination handlers
  const goToPage = useCallback((newPage) => {
    setPage(newPage);
  }, []);
  
  const goToPrevPage = useCallback(() => {
    if (page > 1) {
      setPage(page - 1);
    }
  }, [page]);
  
  const goToNextPage = useCallback(() => {
    if (page < totalPages) {
      setPage(page + 1);
    }
  }, [page, totalPages]);
  
  // Share link handler - builds from current filter state
  const copyShareLink = useCallback(() => {
    const params = new URLSearchParams();
    
    if (filters.sortOrder !== 'newest') {
      params.set('sort', filters.sortOrder);
    }
    if (filters.genres.length > 0) {
      params.set('genres', filters.genres.join(','));
    }
    if (filters.hdrTypes.length > 0) {
      params.set('hdr', filters.hdrTypes.join(','));
    }
    if (page > 1) {
      params.set('page', page.toString());
    }
    
    const query = params.toString();
    const url = query 
      ? `${window.location.origin}${pathname}?${query}`
      : `${window.location.origin}${pathname}`;
    
    navigator.clipboard.writeText(url)
      .then(() => {
        alert('Share link copied to clipboard!');
      })
      .catch(err => {
        console.error('Failed to copy share link:', err);
      });
  }, [filters, page, pathname]);
  
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
              value={filters.sortOrder}
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
                    isSelected={filters.genres.includes(genre)}
                    onToggle={handleGenreToggle}
                  />
                )) : (
                  <div className="w-full md:w-auto">
                    <div className="flex flex-wrap gap-2 max-w-3xl">
                      {Array.from({ length: 8 }, (_, i) => (
                        <div key={`genre-skeleton-${i}`} className="h-6 bg-gray-700 animate-pulse rounded-full" style={{ width: `68px` }}></div>
                      ))}
                    </div>
                  </div>
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
                    isSelected={filters.hdrTypes.includes(hdrType)}
                    onToggle={handleHdrTypeToggle}
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
            {(filters.genres.length > 0 || filters.hdrTypes.length > 0) ? (
              <div className="flex items-center">
                <span className="text-sm text-gray-200">
                  Showing {totalCount} TV shows with selected filters
                  {filters.genres.length > 0 && ` (Genres: ${filters.genres.join(', ')})`}
                  {filters.hdrTypes.length > 0 && ` (HDR: ${filters.hdrTypes.join(', ')})`}
                  {isPending && <span className="text-gray-400 ml-1">(updating...)</span>}
                </span>
                <button
                  onClick={handleClearFilters}
                  className="ml-3 text-xs text-indigo-200 hover:text-indigo-300"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <span className="text-sm text-gray-200">
                Showing {totalPages > 0 ? `${page} of ${totalPages}` : '0'} pages ({totalCount} TV shows)
              </span>
            )}
            {/* Share button */}
            {(filters.genres.length > 0 || filters.hdrTypes.length > 0 || filters.sortOrder !== 'newest' || page > 1) && (
              <button
                onClick={copyShareLink}
                className="text-sm text-indigo-200 hover:text-indigo-300 flex items-center gap-1"
                title="Copy shareable link with current filters"
              >
                <ShareIcon className='w-4 h-4' />
                Share View
              </button>
            )}
            {/* Loading indicator */}
            {isPending && (
              <Loading fullscreenClasses={false} containerClassnames='inline-block' padding="p-0" size="w-6 h-6" />
            )}
          </div>
          
          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="flex items-center space-x-2">
              <button
                onClick={goToPrevPage}
                disabled={page === 1 || isPending}
                className={`px-2 py-1 rounded bg-gray-800 text-white ${page === 1 || isPending ? 'delay-300 opacity-50 cursor-not-allowed' : 'hover:bg-gray-700'}`}
              >
                &lt;
              </button>
              
              {/* Page numbers */}
              {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
                let pageNum;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (page <= 3) {
                  pageNum = i + 1;
                } else if (page >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = page - 2 + i;
                }
                
                return (
                  <button
                    key={pageNum}
                    onClick={() => goToPage(pageNum)}
                    disabled={isPending}
                    className={`w-8 h-8 rounded ${
                      page === pageNum 
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
                disabled={page === totalPages || isPending}
                className={`px-2 py-1 rounded bg-gray-800 text-white ${page === totalPages || isPending ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-700'}`}
              >
                &gt;
              </button>
            </div>
          )}
        </div>
      </li>

      {/* Display TV shows */}
      {currentTVShows.length === 0 ? (
        <li className="col-span-full">
          <p className="text-center text-gray-400 py-10">
            No TV shows found with the selected filters. Try adjusting your filter criteria.
          </p>
        </li>
      ) : (
        currentTVShows.map((tv, index) => (
          <li key={tv.title + '-' + index} className="relative min-w-[250px] max-w-sm">
            <TVCard tv={tv} index={index} />
          </li>
        ))
      )}
    </>
  );
}