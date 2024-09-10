'use client'
import { lazy, Suspense, useEffect, useState } from 'react'
import { MagnifyingGlassIcon } from '@heroicons/react/20/solid'
import { buildURL, classNames } from '@src/utils'
import debounce from 'lodash.debounce'
import Count from './Count'
const SearchModal = lazy(() => import('./SearchModal'))

export default function SearchInput() {
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [recentlyAddedMedia, setRecentlyAddedMedia] = useState([])
  const [open, setOpen] = useState(false)

  // Function to fetch search results, debounced using lodash
  const fetchSearchResults = debounce(async (query) => {
    setIsLoading(true)
    try {
      const response = await fetch(buildURL('/api/authenticated/search'), {
        method: 'POST',
        body: JSON.stringify({ query }),
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await response.json()
      setSearchResults(data.results)
    } catch (error) {
      console.error('Error fetching data:', error)
    } finally {
      setIsLoading(false)
    }
  }, 600)

  // Fetch recently added media
  useEffect(() => {
    let attempts = 0
    const fetchRecentlyAddedMedia = async () => {
      setIsLoading(true)
      try {
        const response = await fetch(buildURL('/api/authenticated/search'), {
          method: 'POST',
          body: JSON.stringify({ query: '' }),
          headers: { 'Content-Type': 'application/json' },
        })
        const data = await response.json()
        setRecentlyAddedMedia(data.results)
        attempts = 0
      } catch (error) {
        console.error('Error fetching recently added media:', error)
        attempts++
        if (attempts <= 3) {
          fetchRecentlyAddedMedia()
        }
      } finally {
        setIsLoading(false)
      }
    }
    fetchRecentlyAddedMedia()
  }, [])

  // Trigger debounced search function when query changes
  useEffect(() => {
    if (query) {
      fetchSearchResults(query)
    } else {
      setSearchResults(recentlyAddedMedia)
    }

    // Cleanup function to cancel debounced calls on unmount
    return () => {
      fetchSearchResults.cancel()
    }
  }, [query, recentlyAddedMedia])

  useEffect(() => {
    if (!open) {
      setQuery('')
    }
  }, [open])

  return (
    <>
      <div
        className={classNames(
          !open
            ? 'w-full divide-y divide-gray-100 rounded-xl shadow-2xl ring-1 ring-black ring-opacity-5 transform'
            : 'w-10 h-10 rounded-full',
          'relative mx-auto max-w-3xl overflow-hidden bg-gray-50 transition-[width] ease-in-out duration-800'
        )}
      >
        <MagnifyingGlassIcon
          className={classNames(
            !open ? 'left-4 top-3.5' : 'left-[0.6rem] top-[0.6rem]',
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
            onClick={() => setOpen(true)}
            onChange={(event) => {
              if (query.length < event.target.value.length) {
                setOpen(true)
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
          setOpen={setOpen}
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
