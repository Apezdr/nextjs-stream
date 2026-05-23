'use client'
import { lazy, Suspense, useCallback, useEffect, useState, useEffectEvent, useRef } from 'react'
import useSWR from 'swr'
import { MagnifyingGlassIcon } from '@heroicons/react/20/solid'
import { classNames } from '@src/utils'
import debounce from 'lodash.debounce'
import Count from './Count'
const SearchModal = lazy(() => import('./SearchModal'))

// Stable empty reference so effects depending on the SWR result don't loop
// while data is still undefined (a fresh `[]` literal would change identity
// every render).
const EMPTY_RESULTS = []

// Fetch the "recently added" list shown when the search box is empty.
const fetchRecentlyAdded = async () => {
  const response = await fetch('/api/authenticated/search', {
    method: 'POST',
    body: JSON.stringify({ query: '' }),
    headers: { 'Content-Type': 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  const data = await response.json()
  return data.results || []
}

export default function SearchInput() {
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [open, setOpen] = useState(false)

  // Recently added media (shown when the query is empty) via SWR — handles
  // caching and error retry/backoff, so no manual retry effect is needed.
  const { data: recentlyAddedMedia = EMPTY_RESULTS, isLoading: recentLoading } = useSWR(
    'search-recently-added',
    fetchRecentlyAdded,
    { revalidateOnFocus: false, errorRetryCount: 3 }
  )

  const isLoading = searchLoading || (!query && recentLoading)

  // Ref to hold abort controller for cleanup
  const abortControllerRef = useRef(null)
  // Ref to hold debounced function
  const debouncedFetchRef = useRef(null)

  // React 19.2 useEffectEvent: Extract the "event" logic that uses latest state
  // This function always sees the latest state but doesn't trigger re-renders
  const onSearchQuery = useEffectEvent(async (searchQuery) => {
    // Cancel any ongoing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    // Create new abort controller for this request
    abortControllerRef.current = new AbortController()

    setSearchLoading(true)
    try {
      const response = await fetch('/api/authenticated/search', {
        method: 'POST',
        body: JSON.stringify({ query: searchQuery }),
        headers: { 'Content-Type': 'application/json' },
        signal: abortControllerRef.current.signal
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data = await response.json()
      setSearchResults(data.results || [])
    } catch (error) {
      // Ignore abort errors (they're expected when canceling)
      if (error.name !== 'AbortError') {
        console.error('Error fetching search data:', error)
      }
    } finally {
      setSearchLoading(false)
    }
  })

  // Initialize debounced function once - it calls the Effect Event
  useEffect(() => {
    debouncedFetchRef.current = debounce((searchQuery) => {
      onSearchQuery(searchQuery)
    }, 600)
    
    return () => {
      // Cancel any pending debounced calls
      debouncedFetchRef.current?.cancel()
      // Abort any ongoing fetch
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, []) // onSearchQuery is from useEffectEvent, stable reference

  // Trigger search when query changes
  useEffect(() => {
    if (query) {
      debouncedFetchRef.current?.(query)
    } else {
      setSearchResults(recentlyAddedMedia)
    }
  }, [query, recentlyAddedMedia]) // ✅ Only reactive values, not functions

  // Open/close the search, resetting the query on close. Done in this action
  // handler (not an effect) so the search-trigger effect doesn't chain off it.
  const handleSetOpen = useCallback((nextOpen) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      setQuery('')
    }
  }, [])

  return (
    <>
      <div
        className={classNames(
          !open
            ? 'w-10 h-10 lg:h-auto rounded-full lg:w-full lg:divide-y lg:divide-gray-100 lg:rounded-xl lg:shadow-2xl lg:ring-1 lg:ring-black lg:ring-opacity-5 lg:transform'
            : 'w-10 h-10 rounded-full',
          'relative mr-auto lg:mx-auto max-w-3xl overflow-hidden bg-gray-50 transition-[width] ease-in-out duration-800'
        )}
      >
        <MagnifyingGlassIcon
          className={classNames(
            !open ? 'left-[0.6rem] top-[0.6rem] lg:left-4 lg:top-3.5' : 'left-[0.6rem] top-[0.6rem]',
            'pointer-events-none absolute h-5 w-5 text-gray-400'
          )}
          aria-hidden="true"
        />
        <span
          className={classNames(
            !open ? 'left-[0.9rem]' : 'left-0 w-full text-center',
            'text-[8px] absolute top-[1.6rem] text-black border-none'
          )}
        >
          {open ? <Count data={searchResults.length} /> : null}
        </span>
        {!open ? (
          <input
            className="h-12 w-full border-0 bg-transparent pl-11 pr-4 text-gray-900 placeholder:text-gray-400 focus:ring-0 sm:text-sm"
            placeholder="Search..."
            value={query}
            onClick={() => handleSetOpen(true)}
            onChange={(event) => {
              if (query.length < event.target.value.length) {
                handleSetOpen(true)
              }
              setQuery(event.target.value)
            }}
            type="text"
          />
        ) : null}
      </div>
      <Suspense>
        <SearchModal
          open={open}
          setOpen={handleSetOpen}
          query={query}
          setQuery={setQuery}
          isLoading={isLoading}
          searchResults={searchResults}
          recentlyAddedMedia={recentlyAddedMedia}
        />
      </Suspense>
    </>
  )
}
