import React, { Fragment, memo, useId, useMemo, useCallback, useState, useEffect } from 'react'
import { Dialog, DialogPanel, Transition, TransitionChild } from '@headlessui/react'
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react'
import { Combobox, ComboboxOptions, ComboboxOption } from '@headlessui/react'
import { ErrorBoundary } from 'react-error-boundary'
import { buildURL, classNames } from '@src/utils'
import Link from 'next/link'
import Loading from '@src/app/loading'
import {
  MagnifyingGlassIcon,
  UsersIcon,
  XMarkIcon,
  ChevronRightIcon,
  FunnelIcon,
  XCircleIcon,
} from '@heroicons/react/20/solid'
import RetryImage from '@components/RetryImage'
import Detailed from '@components/Poster/Detailed'
import MediaPoster from '@components/MediaPoster'
import ResultsPane from './ResultsPane'


/**
 * Error fallback component for search results
 * React 19.2 error boundary pattern
 */
const SearchErrorFallback = ({ error, resetErrorBoundary }) => (
  <div className="px-6 py-14 text-center text-sm sm:px-14">
    <UsersIcon className="mx-auto h-6 w-6 text-red-400" aria-hidden="true" />
    <p className="mt-4 font-semibold text-gray-900">Search encountered an error</p>
    <p className="mt-2 text-gray-500">{error.message || 'Please try again'}</p>
    <button
      onClick={resetErrorBoundary}
      className="mt-4 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
    >
      Try again
    </button>
  </div>
)

/**
 * SearchModal with HeadlessUI v2 + React 19.2 best practices
 *
 * Features:
 * - HeadlessUI v2 Tab component for grouped results
 * - HeadlessUI v2 native virtualization (powered by TanStack Virtual)
 * - Dedicated "Actors" tab for cast member search
 * - Advanced filtering UI: genre, cast, year, HDR, resolution
 * - Server-side filtering via onFiltersChange callback
 * - React 18/19.2 hooks: useId, useMemo, useCallback, memo
 * - React 19.2 ErrorBoundary pattern
 * - Smart tab auto-selection based on query type
 * - Optimal performance for all list sizes
 */
const SearchModal = ({
  open,
  setOpen,
  query,
  setQuery,
  isLoading,
  searchResults,
  recentlyAddedMedia,
  onFiltersChange, // Optional callback for server-side filtering
}) => {
  // React 18/19 best practice: SSR-safe ID generation
  const searchInputId = useId()

  // ResultsPane tab state (for client-side filtering)
  const [activeResultsTab, setActiveResultsTab] = useState('all')
  
  // Combobox controlled state
  const [selected, setSelected] = useState(null)
  
  // Track expanded cast members (by cast ID)
  const [expandedCast, setExpandedCast] = useState(new Set())
  
  // Filter panel state
  const [showFilters, setShowFilters] = useState(false)
  
  // Filter state object
  const [filters, setFilters] = useState({
    genres: [], // Array of genre names
    cast: '', // String for cast name search
    year: null, // Single year (number)
    yearFrom: null, // Range start
    yearTo: null, // Range end
    hdr: 'any', // 'any' | 'hdr' | 'nonHdr'
    resolution: 'any', // 'any' | 'SD' | 'HD' | '4K'
  })
  
  // Call onFiltersChange when filters update (defensive check)
  useEffect(() => {
    if (typeof onFiltersChange === 'function') {
      onFiltersChange(filters)
    }
  }, [filters, onFiltersChange])

  // Stable callback reference
  const handleClose = useCallback(() => {
    setOpen(false)
    setExpandedCast(new Set())
    setActiveResultsTab('all')
  }, [setOpen])
  
  // Toggle cast member expansion
  const toggleCastExpansion = useCallback((castId) => {
    setExpandedCast(prev => {
      const next = new Set(prev)
      if (next.has(castId)) {
        next.delete(castId)
      } else {
        next.add(castId)
      }
      return next
    })
  }, [])

  // Filter data based on active ResultsPane tab (for Combobox virtualization)
  const displayData = useMemo(() => {
    const baseResults = query ? searchResults : recentlyAddedMedia
    
    if (activeResultsTab === 'all') {
      return baseResults
    } else if (activeResultsTab === 'titles') {
      return baseResults.filter(item =>
        item.type === 'movie' || item.type === 'tv' ||
        ['title', 'genre', 'year', 'hdr', 'resolution'].includes(item.matchType)
      )
    } else if (activeResultsTab === 'people') {
      return baseResults.filter(item =>
        item.type === 'person' || ['person', 'cast', 'castName'].includes(item.matchType)
      )
    }
    return baseResults
  }, [query, searchResults, recentlyAddedMedia, activeResultsTab])

  // Handle cast member click (MUST be before handleComboboxChange)
  const handleCastMemberClick = useCallback((castName) => {
    setFilters(prev => ({ ...prev, cast: castName }))
    setQuery(castName)
    setActiveResultsTab('people')
  }, [setQuery])
  
  // Handle Combobox selection
  const handleComboboxChange = useCallback((item) => {
    setSelected(item)
    
    // Handle person selection
    if (item && (item.type === 'person' || item.matchType === 'person' || item.matchType === 'castName')) {
      handleCastMemberClick(item.name || item)
      return
    }
    
    // Handle media selection - close modal
    if (item) {
      handleClose()
    }
  }, [handleCastMemberClick, handleClose])
  
  // Remove a specific filter chip
  const removeFilter = useCallback((filterKey, value) => {
    setFilters(prev => {
      if (filterKey === 'genres') {
        return { ...prev, genres: prev.genres.filter(g => g !== value) }
      } else if (filterKey === 'cast') {
        return { ...prev, cast: '' }
      } else if (filterKey === 'year' || filterKey === 'yearRange') {
        return { ...prev, year: null, yearFrom: null, yearTo: null }
      } else if (filterKey === 'hdr') {
        return { ...prev, hdr: 'any' }
      } else if (filterKey === 'resolution') {
        return { ...prev, resolution: 'any' }
      }
      return prev
    })
  }, [])
  
  // Clear all filters
  const clearAllFilters = useCallback(() => {
    setFilters({
      genres: [],
      cast: '',
      year: null,
      yearFrom: null,
      yearTo: null,
      hdr: 'any',
      resolution: 'any',
    })
  }, [])
  
  // Get active filter count
  const activeFilterCount = useMemo(() => {
    let count = 0
    if (filters.genres.length > 0) count += filters.genres.length
    if (filters.cast.trim()) count++
    if (filters.year || filters.yearFrom || filters.yearTo) count++
    if (filters.hdr !== 'any') count++
    if (filters.resolution !== 'any') count++
    return count
  }, [filters])

  return (
    <Transition
      show={open}
      as={Fragment}
      beforeEnter={() => window.document.getElementById(searchInputId)?.focus()}
      afterLeave={() => null}
      appear
    >
      <Dialog as="div" className="relative z-20" onClose={handleClose}>
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div
            className="fixed inset-0 bg-gray-500 bg-opacity-25 transition-opacity"
            role="button"
            tabIndex={0}
            onClick={handleClose}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                handleClose()
              }
            }}
          />
        </TransitionChild>

        <div className="fixed inset-0 z-20 w-screen overflow-y-auto p-4 sm:p-6 md:p-8">
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <DialogPanel className="mx-auto max-w-7xl transform overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black ring-opacity-5 transition-all">
              {/* React 19.2: Error boundary for search functionality */}
              <ErrorBoundary FallbackComponent={SearchErrorFallback} onReset={handleClose}>
                {/* Search input with Filters button */}
                <div className="relative border-b border-gray-100">
                  <MagnifyingGlassIcon
                    className="pointer-events-none absolute left-4 top-3.5 h-5 w-5 text-gray-400"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    className="h-12 w-full border-0 bg-transparent pl-11 pr-24 text-gray-900 placeholder:text-gray-400 focus:ring-0 sm:text-sm"
                    placeholder="Search by title, actor, genre, year, HDR, or resolution..."
                    id={searchInputId}
                    aria-label="Search input"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <button
                    type="button"
                    className="absolute right-16 top-2 rounded-md p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    onClick={() => setShowFilters(!showFilters)}
                    aria-label="Toggle filters"
                    aria-expanded={showFilters}
                  >
                    <FunnelIcon className="h-5 w-5" />
                    {activeFilterCount > 0 && (
                      <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-indigo-600 text-white text-xs font-semibold flex items-center justify-center">
                        {activeFilterCount}
                      </span>
                    )}
                  </button>
                  <XMarkIcon
                    className="p-1.5 rounded-full absolute right-4 top-[0.55rem] h-[2.05rem] w-[2.05rem] text-gray-400 hover:text-gray-500 focus:text-gray-500 cursor-pointer"
                    onClick={handleClose}
                    aria-label="Close search"
                  />
                </div>
                
                {/* Filter Panel */}
                {showFilters && (
                  <div className="border-b border-gray-200 bg-gray-50 px-4 py-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {/* Genre Filter */}
                      <div>
                        <label htmlFor="filter-genre" className="block text-xs font-medium text-gray-700 mb-1">
                          Genre
                        </label>
                        <input
                          id="filter-genre"
                          type="text"
                          className="w-full rounded-md text-gray-900 border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                          placeholder="e.g., Action, Comedy"
                          value={filters.genres.join(', ')}
                          onChange={(e) => {
                            const genresInput = e.target.value
                            const genreArray = genresInput
                              .split(',')
                              .map(g => g.trim())
                              .filter(g => g.length > 0)
                            setFilters(prev => ({ ...prev, genres: genreArray }))
                          }}
                        />
                      </div>
                      
                      {/* Cast Filter */}
                      <div>
                        <label htmlFor="filter-cast" className="block text-xs font-medium text-gray-700 mb-1">
                          Cast/Actor
                        </label>
                        <input
                          id="filter-cast"
                          type="text"
                          className="w-full rounded-md text-gray-900 border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                          placeholder="Actor name"
                          value={filters.cast}
                          onChange={(e) => setFilters(prev => ({ ...prev, cast: e.target.value }))}
                        />
                      </div>
                      
                      {/* Year Filter */}
                      <div>
                        <label htmlFor="filter-year" className="block text-xs font-medium text-gray-700 mb-1">
                          Release Year
                        </label>
                        <div className="flex gap-2">
                          <input
                            id="filter-year"
                            type="number"
                            className="w-full rounded-md text-gray-900 border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                            placeholder="Year"
                            min="1900"
                            max="2100"
                            value={filters.year || ''}
                            onChange={(e) => {
                              const year = e.target.value ? parseInt(e.target.value, 10) : null
                              setFilters(prev => ({ ...prev, year }))
                            }}
                          />
                        </div>
                      </div>
                      
                      {/* Year Range */}
                      <div>
                        <label className="block text-xs font-medium text-gray-900 mb-1">
                          Year Range (optional)
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            className="w-1/2 rounded-md text-gray-900 border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                            placeholder="From"
                            min="1900"
                            max="2100"
                            value={filters.yearFrom || ''}
                            onChange={(e) => {
                              const yearFrom = e.target.value ? parseInt(e.target.value, 10) : null
                              setFilters(prev => ({ ...prev, yearFrom }))
                            }}
                            aria-label="Year from"
                          />
                          <input
                            type="number"
                            className="w-1/2 rounded-md text-gray-900 border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                            placeholder="To"
                            min="1900"
                            max="2100"
                            value={filters.yearTo || ''}
                            onChange={(e) => {
                              const yearTo = e.target.value ? parseInt(e.target.value, 10) : null
                              setFilters(prev => ({ ...prev, yearTo }))
                            }}
                            aria-label="Year to"
                          />
                        </div>
                      </div>
                      
                      {/* HDR Filter (tri-state segmented control) */}
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          HDR
                        </label>
                        <div className="flex rounded-md shadow-sm" role="group" aria-label="HDR filter">
                          <button
                            type="button"
                            className={classNames(
                              'flex-1 px-3 py-2 text-xs font-medium rounded-l-md border focus:z-10 focus:outline-none focus:ring-2 focus:ring-indigo-500',
                              filters.hdr === 'any'
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                            )}
                            onClick={() => setFilters(prev => ({ ...prev, hdr: 'any' }))}
                          >
                            Any
                          </button>
                          <button
                            type="button"
                            className={classNames(
                              'flex-1 px-3 py-2 text-xs font-medium border-t border-b focus:z-10 focus:outline-none focus:ring-2 focus:ring-indigo-500',
                              filters.hdr === 'hdr'
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                            )}
                            onClick={() => setFilters(prev => ({ ...prev, hdr: 'hdr' }))}
                          >
                            HDR Only
                          </button>
                          <button
                            type="button"
                            className={classNames(
                              'flex-1 px-3 py-2 text-xs font-medium rounded-r-md border focus:z-10 focus:outline-none focus:ring-2 focus:ring-indigo-500',
                              filters.hdr === 'nonHdr'
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                            )}
                            onClick={() => setFilters(prev => ({ ...prev, hdr: 'nonHdr' }))}
                          >
                            Non-HDR
                          </button>
                        </div>
                      </div>
                      
                      {/* Resolution Filter */}
                      <div>
                        <label htmlFor="filter-resolution" className="block text-xs font-medium text-gray-700 mb-1">
                          Resolution
                        </label>
                        <select
                          id="filter-resolution"
                          className="w-full text-gray-700 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                          value={filters.resolution}
                          onChange={(e) => setFilters(prev => ({ ...prev, resolution: e.target.value }))}
                        >
                          <option value="any">Any</option>
                          <option value="SD">SD (≤720p)</option>
                          <option value="HD">HD (720p/1080p)</option>
                          <option value="4K">4K (≥3840)</option>
                        </select>
                      </div>
                    </div>
                    
                    {/* Clear Filters Button */}
                    {activeFilterCount > 0 && (
                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          className="text-sm text-indigo-600 hover:text-indigo-800 font-medium focus:outline-none focus:underline"
                          onClick={clearAllFilters}
                        >
                          Clear all filters
                        </button>
                      </div>
                    )}
                  </div>
                )}
                
                {/* Active Filter Chips */}
                {activeFilterCount > 0 && (
                  <div className="border-b border-gray-200 bg-white px-4 py-2 flex flex-wrap gap-2 items-center">
                    <span className="text-xs font-medium text-gray-500">Active filters:</span>
                    {filters.genres.map(genre => (
                      <span
                        key={genre}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800"
                      >
                        Genre: {genre}
                        <button
                          type="button"
                          className="hover:text-indigo-600 focus:outline-none"
                          onClick={() => removeFilter('genres', genre)}
                          aria-label={`Remove ${genre} filter`}
                        >
                          <XCircleIcon className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ))}
                    {filters.cast.trim() && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                        Cast: {filters.cast}
                        <button
                          type="button"
                          className="hover:text-purple-600 focus:outline-none"
                          onClick={() => removeFilter('cast')}
                          aria-label="Remove cast filter"
                        >
                          <XCircleIcon className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    )}
                    {(filters.year || filters.yearFrom || filters.yearTo) && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        Year: {filters.year || `${filters.yearFrom || '?'}-${filters.yearTo || '?'}`}
                        <button
                          type="button"
                          className="hover:text-green-600 focus:outline-none"
                          onClick={() => removeFilter('year')}
                          aria-label="Remove year filter"
                        >
                          <XCircleIcon className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    )}
                    {filters.hdr !== 'any' && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                        {filters.hdr === 'hdr' ? 'HDR Only' : 'Non-HDR'}
                        <button
                          type="button"
                          className="hover:text-yellow-600 focus:outline-none"
                          onClick={() => removeFilter('hdr')}
                          aria-label="Remove HDR filter"
                        >
                          <XCircleIcon className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    )}
                    {filters.resolution !== 'any' && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        {filters.resolution}
                        <button
                          type="button"
                          className="hover:text-blue-600 focus:outline-none"
                          onClick={() => removeFilter('resolution')}
                          aria-label="Remove resolution filter"
                        >
                          <XCircleIcon className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    )}
                  </div>
                )}

                {isLoading ? (
                  <Loading fullscreenClasses="" />
                ) : (query === '' || searchResults.length > 0) ? (
                  /* HeadlessUI v2 Combobox with virtual scrolling */
                  <Combobox
                    value={selected}
                    onChange={handleComboboxChange}
                    by={(a, b) => (a?._id ?? a?.id) === (b?._id ?? b?.id)}
                    virtual={{ options: displayData }}
                  >
                    {({ activeOption }) => (
                      <>
                        <div className="flex divide-x divide-gray-100 h-[42rem] max-h-[80vh]">
                          <div className="min-w-0 w-[420px] flex flex-col">
                            {/* Tabs outside Combobox */}
                            <ResultsPane
                              data={query ? searchResults : recentlyAddedMedia}
                              activeTab={activeResultsTab}
                              onTabChange={setActiveResultsTab}
                            />
                            
                            {/* Virtualized list */}
                            <ComboboxOptions static hold className="flex-1 overflow-y-auto px-2 py-2">
                              {({ option: item }) => (
                                <ResultsPane.Item
                                  item={item}
                                  isActive={activeOption && (activeOption._id === item._id || activeOption.id === item.id)}
                                  onCastClick={handleCastMemberClick}
                                  onSelect={handleClose}
                                  asOption={true}
                                />
                              )}
                            </ComboboxOptions>
                          </div>

                          {/* Right inspector */}
                          <div className="hidden sm:block w-1/2 flex-none flex-col overflow-hidden">
                            <div className="flex-1 p-6 text-center overflow-y-auto" style={{ maxHeight: 'calc(80vh - 100px)' }}>
                              {activeOption && activeOption.type === 'tv' ? (
                                <div key={activeOption.id || activeOption.url}>
                                  <Detailed tvShow={activeOption} contClassName={'w-auto max-w-[280px] mb-4'} posterOnly={true} hideGenres={false} size={{ w: 400, h: 600 }} quality={100} loadingType={'eager'} contClassNamePoster="" check4kandHDR={true} />
                                  {activeOption.metadata?.tagline && <p className="text-sm italic text-gray-500">"{activeOption.metadata.tagline}"</p>}
                                  <h2 className="text-lg font-semibold text-gray-900">{activeOption.title}</h2>
                                  {activeOption.release_date && <p className="text-sm text-gray-500">Released: {new Date(activeOption.release_date).toLocaleDateString()}</p>}
                                  {activeOption.metadata?.overview && <p className="text-sm leading-6 text-gray-500 line-clamp-4">{activeOption.metadata.overview}</p>}
                                </div>
                              ) : activeOption && activeOption.type === 'movie' ? (
                                <div className="space-y-3" key={activeOption.id || activeOption.url}>
                                  <MediaPoster movie={activeOption} imagePriority={true} className='max-w-[280px]' contClassName="max-w-[280px] mx-auto" size={{ w: 400, h: 600 }} quality={100} />
                                  {activeOption.tagline && <p className="text-sm italic text-gray-500">"{activeOption.tagline}"</p>}
                                  <h2 className="text-lg font-semibold text-gray-900">{activeOption.title}</h2>
                                  {activeOption.release_date && <p className="text-sm text-gray-500">Released: {new Date(activeOption.release_date).toLocaleDateString()}</p>}
                                  {activeOption.metadata?.overview && <p className="text-sm leading-6 text-gray-500 line-clamp-4">{activeOption.metadata.overview}</p>}
                                </div>
                              ) : null}
                            </div>
                            {activeOption && activeOption.type !== 'castName' && activeOption.type !== 'person' && (
                              <div className="flex-none p-4 border-t border-gray-100 bg-white">
                                <Link href={buildURL(activeOption.url)} type="button" className="w-full rounded-md bg-indigo-600 px-3 py-2 text-center text-sm font-semibold text-white shadow-sm hover:bg-indigo-500" onClick={handleClose}>Open this</Link>
                              </div>
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </Combobox>
                ) : null}

                {query !== '' && searchResults.length === 0 && !isLoading && (
                  <div className="px-6 py-14 text-center text-sm sm:px-14">
                    <UsersIcon className="mx-auto h-6 w-6 text-gray-400" aria-hidden="true" />
                    <p className="mt-4 font-semibold text-gray-900">Nothing found for that query</p>
                    <p className="mt-2 text-gray-500">We couldn't find anything with that query. Try searching by title, actor name, genre, year (e.g., "1994"), "HDR", or resolution (e.g., "4K").</p>
                  </div>
                )}
              </ErrorBoundary>
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  )
}

export default memo(SearchModal)
