'use client'
import { lazy, Suspense, useCallback, useState } from 'react'
import { MagnifyingGlassIcon } from '@heroicons/react/20/solid'
import { classNames } from '@src/utils'
import Count from './Count'
import { useSearchResults } from './useSearchResults'
const SearchModal = lazy(() => import('./SearchModal'))

export default function SearchInput() {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  // Every result's slot, filled a page at a time: Recently Added while the query is empty
  const { options, total, isLoading, failed, requestPage, retry } = useSearchResults(query)

  // Open/close the search, resetting the query on close. Done in this action
  // handler (not an effect) so the search doesn't chain off it.
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
          {/* Every match, not only the pages loaded so far */}
          {open ? <Count data={total} /> : null}
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
          failed={failed}
          onRetry={retry}
          options={options}
          onRequestPage={requestPage}
        />
      </Suspense>
    </>
  )
}
