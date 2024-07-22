'use client'
import { Fragment, useEffect, useRef, useState } from 'react'
import {
  Combobox,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
  Dialog,
  DialogPanel,
  Transition,
  TransitionChild,
} from '@headlessui/react'
import { MagnifyingGlassIcon, UsersIcon, ChevronRightIcon } from '@heroicons/react/20/solid'
import { buildURL, classNames } from 'src/utils'
import Link from 'next/link'
import debounce from 'lodash.debounce'
import Image from 'next/image'
import Loading from 'src/app/loading'
import MediaPoster from '@components/MediaPoster'
import Detailed from '@components/Poster/Detailed'

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
      <div className="relative mx-auto max-w-3xl transform divide-y divide-gray-100 overflow-hidden rounded-xl bg-gray-50 shadow-2xl ring-1 ring-black ring-opacity-5 transition-all">
        <MagnifyingGlassIcon
          className="pointer-events-none absolute left-4 top-3.5 h-5 w-5 text-gray-400"
          aria-hidden="true"
        />
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
      </div>
      <Transition
        show={open}
        as={Fragment}
        beforeEnter={() => window.document.getElementById('search')?.focus()}
        afterLeave={() => null}
        appear
      >
        <Dialog as="div" className="relative z-10" onClose={() => setOpen(false)}>
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
              onClick={() => setOpen(false)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setOpen(false)
                }
              }}
            />
          </TransitionChild>

          <div className="fixed inset-0 z-10 w-screen overflow-y-auto p-4 sm:p-6 md:p-20">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel className="mx-auto max-w-7xl transform divide-y divide-gray-100 overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black ring-opacity-5 transition-all">
                <Combobox>
                  {({ activeOption }) => {
                    let dims, is4k, is1080p
                    if (activeOption?.dimensions) {
                      dims = activeOption?.dimensions?.split('x')
                      is4k = parseInt(dims[0]) >= 3840 || parseInt(dims[1]) >= 2160
                      is1080p = parseInt(dims[0]) >= 1920 || parseInt(dims[1]) >= 1080
                    }
                    return (
                      <>
                        <div className="relative">
                          <MagnifyingGlassIcon
                            className="pointer-events-none absolute left-4 top-3.5 h-5 w-5 text-gray-400"
                            aria-hidden="true"
                          />
                          <ComboboxInput
                            className="h-12 w-full border-0 bg-transparent pl-11 pr-4 text-gray-900 placeholder:text-gray-400 focus:ring-0 sm:text-sm"
                            placeholder="Search..."
                            id="search"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                          />
                        </div>

                        {isLoading ? (
                          <Loading fullscreenClasses="" />
                        ) : (
                          (query === '' || searchResults.length > 0) && (
                            <ComboboxOptions
                              as="div"
                              static
                              hold
                              className="flex transform-gpu divide-x divide-gray-100"
                            >
                              <div
                                className={classNames(
                                  'max-h-[80vh] min-w-0 flex-auto scroll-py-4 overflow-y-auto px-6 py-4',
                                  activeOption && 'sm:h-[42rem]'
                                )}
                              >
                                {query === '' && (
                                  <h2 className="mb-4 mt-2 text-xs font-semibold text-gray-500">
                                    Recent additions
                                  </h2>
                                )}
                                <div className="-mx-2 text-sm text-gray-700">
                                  {recentlyAddedMedia.length === 0 && (
                                    <Loading fullscreenClasses="" />
                                  )}
                                  {(query === '' ? recentlyAddedMedia : searchResults).map(
                                    (media) =>
                                      media && (
                                        <ComboboxOption
                                          as="div"
                                          key={media.title}
                                          value={media}
                                          className={({ active }) =>
                                            classNames(
                                              'flex cursor-default select-none items-center rounded-md p-2',
                                              active && 'bg-gray-100 text-gray-900'
                                            )
                                          }
                                        >
                                          {({ active }) => (
                                            <Link href={buildURL(media.url)} className="contents">
                                              <Image
                                                src={media.posterURL}
                                                loading="lazy"
                                                placeholder="blur"
                                                width={32}
                                                height={48}
                                                blurDataURL={`data:image/png;base64,${media.posterBlurhash}`}
                                                alt={media.title}
                                                className="h-12 w-8 flex-none rounded-lg"
                                              />
                                              <div className="ml-3 flex flex-col truncate w-full">
                                                <span>{media.title}</span>
                                                <span className="ml-2 h-5 w-16 text-gray-400">
                                                  ↳{' '}
                                                  {media.type === 'movie'
                                                    ? 'Movie'
                                                    : media.type === 'tv'
                                                      ? 'TV Show'
                                                      : 'TV Episode'}
                                                </span>
                                              </div>
                                              {active && (
                                                <ChevronRightIcon
                                                  className="ml-3 h-5 w-5 flex-none text-gray-400"
                                                  aria-hidden="true"
                                                />
                                              )}
                                            </Link>
                                          )}
                                        </ComboboxOption>
                                      )
                                  )}
                                </div>
                              </div>

                              {activeOption && (
                                <div className="hidden h-[42rem] w-1/2 flex-none flex-col divide-y divide-gray-100 overflow-y-auto sm:flex">
                                  <div className="flex-none p-6 text-center">
                                    {activeOption.type === 'tv' ? (
                                      <Detailed
                                        tvShow={activeOption}
                                        contClassName={'w-auto max-w-sm'}
                                        posterOnly={true}
                                        hideGenres={false}
                                        contClassNamePoster=""
                                        loadingType={'eager'}
                                      />
                                    ) : activeOption.type === 'movie' ? (
                                      <MediaPoster
                                        movie={activeOption.type === 'movie' ? activeOption : null}
                                        imagePriority={true}
                                        contClassNamePoster=""
                                      />
                                    ) : (
                                      <MediaPoster
                                        tv={activeOption.type === 'tv' ? activeOption : null}
                                        movie={activeOption.type === 'movie' ? activeOption : null}
                                        imagePriority={true}
                                      />
                                    )}

                                    <h2 className="mt-3 font-semibold text-gray-900">
                                      {activeOption.title}
                                    </h2>
                                    <p className="text-sm leading-6 text-gray-500">
                                      {activeOption.description}
                                    </p>
                                  </div>
                                  <div className="flex flex-auto flex-col justify-between p-6">
                                    <Link
                                      href={buildURL(activeOption.url)}
                                      type="button"
                                      className="mt-6 w-full rounded-md bg-indigo-600 px-3 py-2 text-center text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                                    >
                                      Open this
                                    </Link>
                                  </div>
                                </div>
                              )}
                            </ComboboxOptions>
                          )
                        )}

                        {query !== '' && searchResults.length === 0 && !isLoading && (
                          <div className="px-6 py-14 text-center text-sm sm:px-14">
                            <UsersIcon
                              className="mx-auto h-6 w-6 text-gray-400"
                              aria-hidden="true"
                            />
                            <p className="mt-4 font-semibold text-gray-900">
                              Nothing found for that query
                            </p>
                            <p className="mt-2 text-gray-500">
                              We couldn’t find anything with that query. Please try again.
                            </p>
                          </div>
                        )}
                      </>
                    )
                  }}
                </Combobox>
              </DialogPanel>
            </TransitionChild>
          </div>
        </Dialog>
      </Transition>
    </>
  )
}
