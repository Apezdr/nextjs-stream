'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useState, useCallback, useTransition, useMemo, useEffect } from 'react'

/**
 * Custom hook to manage URL parameters and filtering/sorting for media lists
 * Encapsulates all router-related functionality to prevent waterfall re-renders
 * 
 * @param {Array} mediaList - The list of media items (movies, TV shows, etc.)
 * @param {Function} extractGenres - Function to extract genres from the media list
 * @param {number} itemsPerPage - Number of items to show per page
 * @param {Function} extractHdrTypes - Optional function to extract HDR types from the media list
 * @returns {Object} - All router state and handler functions
 */
export function useMediaUrlParams(
  mediaList = [], 
  extractGenres = () => [], 
  itemsPerPage = 20, 
  extractHdrTypes = null
) {
  // Use Next.js router hooks
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  
  // State for sorting, filtering, and pagination - initialized from URL if available
  const [sortOrder, setSortOrder] = useState(() => 
    searchParams.get('sort') || 'newest'
  )
  const [selectedGenres, setSelectedGenres] = useState(() => {
    const genres = searchParams.get('genres')
    return genres ? genres.split(',') : []
  })
  const [availableGenres, setAvailableGenres] = useState([])
  
  // HDR filter state
  const [selectedHdrTypes, setSelectedHdrTypes] = useState(() => {
    const hdrTypes = searchParams.get('hdr')
    return hdrTypes ? hdrTypes.split(',') : []
  })
  const [availableHdrTypes, setAvailableHdrTypes] = useState([])
  const [currentPage, setCurrentPage] = useState(() => 
    parseInt(searchParams.get('page') || '1', 10)
  )
  const [isPending, startTransition] = useTransition()
  
  // Function to update URL with current filters - memoized
  const updateURLParams = useCallback((sort, genres, hdrTypes, page) => {
    // Create a new URLSearchParams object from the current search params
    const params = new URLSearchParams(searchParams.toString())
    
    // Only add parameters that have values
    if (sort && sort !== 'newest') {
      params.set('sort', sort)
    } else {
      params.delete('sort')
    }
    
    if (genres && genres.length > 0) {
      params.set('genres', genres.join(','))
    } else {
      params.delete('genres')
    }
    
    if (hdrTypes && hdrTypes.length > 0) {
      params.set('hdr', hdrTypes.join(','))
    } else {
      params.delete('hdr')
    }
    
    if (page && page > 1) {
      params.set('page', page.toString())
    } else {
      params.delete('page')
    }
    
    // Use the router to update the URL without a full page reload
    window.history.replaceState(null, '', `${pathname}?${params.toString()}`)
  }, [searchParams, router, pathname])

  // Extract all unique genres and HDR types when the component mounts or mediaList changes
  useEffect(() => {
    // Extract genres
    const genres = extractGenres(mediaList);
    setAvailableGenres(genres);
    
    // Extract HDR types
    if (extractHdrTypes) {
      // Use custom HDR extraction function if provided
      const hdrTypes = extractHdrTypes(mediaList);
      setAvailableHdrTypes(hdrTypes);
    } else {
      // Default behavior for movies/simple media
      const hdrTypes = new Set();
      mediaList.forEach(item => {
        if (item.hdr) {
          hdrTypes.add(item.hdr);
        }
      });
      setAvailableHdrTypes(Array.from(hdrTypes).sort());
    }
  }, [mediaList, extractGenres, extractHdrTypes])
  
  // Handle toggling a genre selection with optimistic UI update - memoized with useCallback
  const handleGenreToggle = useCallback((genre) => {
    // Pre-calculate new genres state
    const newGenres = selectedGenres.includes(genre)
      ? selectedGenres.filter(g => g !== genre)
      : [...selectedGenres, genre];
    
    // Check if genres state actually changed
    const genresChanged = 
      selectedGenres.includes(genre) !== newGenres.includes(genre);
    
    startTransition(() => {
      // Always update selected genres
      setSelectedGenres(newGenres);
      
      // Only reset page number if genres actually changed
      const targetPage = genresChanged ? 1 : currentPage;
      
      if (genresChanged && currentPage !== 1) {
        setCurrentPage(1);
      }
      
      // Always update URL, but only reset page in URL if genres changed
      updateURLParams(sortOrder, newGenres, selectedHdrTypes, targetPage);
    });
  }, [selectedGenres, currentPage, sortOrder, selectedHdrTypes, updateURLParams]);
  
  // Handle toggling an HDR type selection - memoized with useCallback
  const handleHdrTypeToggle = useCallback((hdrType) => {
    // Pre-calculate new HDR types state
    const newHdrTypes = selectedHdrTypes.includes(hdrType)
      ? selectedHdrTypes.filter(t => t !== hdrType)
      : [...selectedHdrTypes, hdrType];
    
    // Check if HDR types state actually changed
    const hdrTypesChanged = 
      selectedHdrTypes.includes(hdrType) !== newHdrTypes.includes(hdrType);
    
    startTransition(() => {
      // Always update selected HDR types
      setSelectedHdrTypes(newHdrTypes);
      
      // Only reset page number if HDR types actually changed
      const targetPage = hdrTypesChanged ? 1 : currentPage;
      
      if (hdrTypesChanged && currentPage !== 1) {
        setCurrentPage(1);
      }
      
      // Always update URL, but only reset page in URL if HDR types changed
      updateURLParams(sortOrder, selectedGenres, newHdrTypes, targetPage);
    });
  }, [selectedHdrTypes, currentPage, sortOrder, selectedGenres, updateURLParams]);

  // Handle changing sort order - memoized with useCallback
  const handleSortOrderChange = useCallback((newSortOrder) => {
    // Only proceed if sort order is actually changing
    const sortChanged = sortOrder !== newSortOrder;
    
    startTransition(() => {
      // Always update sort order
      setSortOrder(newSortOrder);
      
      // Only reset page number if sort order actually changed
      const targetPage = sortChanged ? 1 : currentPage;
      
      if (sortChanged && currentPage !== 1) {
        setCurrentPage(1);
      }
      
      // Always update URL, but only reset page in URL if sort changed
      updateURLParams(newSortOrder, selectedGenres, selectedHdrTypes, targetPage);
    });
  }, [sortOrder, currentPage, selectedGenres, selectedHdrTypes, updateURLParams]);

  // Filter and sort media based on selected criteria
  const filteredAndSortedMedia = useMemo(() => {
    // Start with all media items
    let filtered = [...mediaList]
    
    // Apply genre filter if any genres are selected
    if (selectedGenres.length > 0) {
      filtered = filtered.filter(item => {
        if (!item.metadata?.genres) return false
        
        // Get all genre names from the item
        const itemGenreNames = item.metadata.genres
          .filter(genre => genre && genre.name)
          .map(genre => genre.name);
          
        // Check if the item has ALL of the selected genres
        return selectedGenres.every(selectedGenre => 
          itemGenreNames.includes(selectedGenre)
        );
      })
    }
    
    // Apply HDR filter if any HDR types are selected
    if (selectedHdrTypes.length > 0) {
      filtered = filtered.filter(item => {
        // Direct HDR property (for movies)
        if (item.hdr) {
          if (typeof item.hdr === 'string') {
            // Handle comma-separated HDR types (e.g., "HDR10, HLG")
            const hdrValues = item.hdr.split(',').map(val => val.trim());
            // Check if any of the HDR values match the selected types
            if (hdrValues.some(val => selectedHdrTypes.includes(val))) {
              return true;
            }
          } else if (selectedHdrTypes.includes(item.hdr)) {
            return true;
          }
        }
        
        // Check nested episodes for TV shows with seasons structure
        if (item.seasons && Array.isArray(item.seasons)) {
          // Look through each season's episodes
          for (const season of item.seasons) {
            if (season.episodes && Array.isArray(season.episodes)) {
              // Check if any episode has the matching HDR type
              for (const episode of season.episodes) {
                if (episode.hdr) {
                  // If it's a string type of HDR (e.g., "HDR10", "Dolby Vision")
                  if (typeof episode.hdr === 'string') {
                    // Split HDR types if they contain commas (e.g., "HDR10, HLG")
                    const hdrValues = episode.hdr.split(',').map(val => val.trim());
                    // Check if any of the HDR values match the selected types
                    if (hdrValues.some(val => selectedHdrTypes.includes(val))) {
                      return true;
                    }
                  }
                  // If it's just a boolean true and we're filtering for generic "HDR"
                  else if (episode.hdr === true && selectedHdrTypes.includes('HDR')) {
                    return true;
                  }
                }
              }
            }
          }
        }
        
        // No matching HDR found
        return false;
      });
    }
    
    // Sort by date - handle both movie release_date and TV last_air_date fields
    filtered.sort((a, b) => {
      // For movies: use release_date, for TV shows: use last_air_date (or first_air_date as fallback)
      const getDateFromItem = (item) => {
        if (item.metadata?.release_date) {
          return new Date(item.metadata.release_date);
        } else if (item.metadata?.last_air_date) {
          return new Date(item.metadata.last_air_date);
        } else if (item.metadata?.first_air_date) {
          return new Date(item.metadata.first_air_date);
        }
        return null;
      };
      
      const dateA = getDateFromItem(a);
      const dateB = getDateFromItem(b);

      if (dateA && dateB) {
        // Sort based on the selected order
        return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
      } else if (dateA) {
        return sortOrder === 'newest' ? -1 : 1;
      } else if (dateB) {
        return sortOrder === 'newest' ? 1 : -1;
      } else {
        // Neither has a date, sort alphabetically by title
        return a.title.localeCompare(b.title);
      }
    });
    
    return filtered
  }, [mediaList, selectedGenres, selectedHdrTypes, sortOrder])

  // Calculate total pages
  const totalPages = Math.ceil(filteredAndSortedMedia.length / itemsPerPage)
  
  // Get current page items
  const currentItems = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    return filteredAndSortedMedia.slice(startIndex, endIndex)
  }, [filteredAndSortedMedia, currentPage, itemsPerPage])
  
  // Handle pagination controls - memoized with useCallback
  const goToNextPage = useCallback(() => {
    const newPage = Math.min(currentPage + 1, totalPages);
    
    // Only update if we're actually changing pages
    if (newPage !== currentPage) {
      startTransition(() => {
        setCurrentPage(newPage);
        // Update URL
        updateURLParams(sortOrder, selectedGenres, selectedHdrTypes, newPage);
      });
    }
  }, [currentPage, totalPages, sortOrder, selectedGenres, selectedHdrTypes, updateURLParams]);
  
  const goToPrevPage = useCallback(() => {
    const newPage = Math.max(currentPage - 1, 1);
    
    // Only update if we're actually changing pages
    if (newPage !== currentPage) {
      startTransition(() => {
        setCurrentPage(newPage);
        // Update URL
        updateURLParams(sortOrder, selectedGenres, selectedHdrTypes, newPage);
      });
    }
  }, [currentPage, sortOrder, selectedGenres, selectedHdrTypes, updateURLParams]);
  
  const goToPage = useCallback((page) => {
    // Only update if we're actually changing pages
    if (page !== currentPage) {
      startTransition(() => {
        setCurrentPage(page);
        // Update URL
        updateURLParams(sortOrder, selectedGenres, selectedHdrTypes, page);
      });
    }
  }, [currentPage, sortOrder, selectedGenres, selectedHdrTypes, updateURLParams]);
  
  // Create a share link that includes the current filters - memoized with useCallback
  const copyShareLink = useCallback(() => {
    // Get the current URL including query parameters
    const url = window.location.href
    navigator.clipboard.writeText(url)
      .then(() => {
        // Show success message
        alert('Share link copied to clipboard!')
      })
      .catch(err => {
        console.error('Failed to copy share link:', err)
      })
  }, []);
  
  // Handle clearing filters
  const handleClearFilters = useCallback(() => {
    // Only clear if there are filters applied
    if (selectedGenres.length > 0 || selectedHdrTypes.length > 0) {
      startTransition(() => {
        setSelectedGenres([]);
        setSelectedHdrTypes([]);
        // If on a page other than 1, reset to page 1
        if (currentPage !== 1) {
          setCurrentPage(1);
          updateURLParams(sortOrder, [], [], 1);
        } else {
          updateURLParams(sortOrder, [], [], currentPage);
        }
      });
    }
  }, [selectedGenres, selectedHdrTypes, currentPage, sortOrder, updateURLParams]);

  // Return all the state and functions
  return {
    // State
    sortOrder,
    selectedGenres,
    availableGenres,
    selectedHdrTypes,
    availableHdrTypes,
    currentPage,
    isPending,
    totalPages,
    filteredAndSortedMedia,
    currentItems,
    
    // Functions
    setSortOrder,
    setSelectedGenres,
    setSelectedHdrTypes,
    setCurrentPage,
    setAvailableGenres,
    setAvailableHdrTypes,
    handleGenreToggle,
    handleHdrTypeToggle,
    handleSortOrderChange,
    goToNextPage,
    goToPrevPage,
    goToPage,
    copyShareLink,
    handleClearFilters
  };
}
