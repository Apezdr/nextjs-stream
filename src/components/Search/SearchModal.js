import React, { Fragment, Activity, memo, useEffect, useId, useCallback } from 'react'
import { Dialog, DialogPanel, Transition, TransitionChild } from '@headlessui/react'
import { Combobox, ComboboxInput, ComboboxOptions, ComboboxOption } from '@headlessui/react'
import { ErrorBoundary } from 'react-error-boundary'
import { buildURL, classNames } from '@src/utils'
import Link from 'next/link'
import Loading from '@src/app/loading'
import {
  MagnifyingGlassIcon,
  UsersIcon,
  XMarkIcon,
  ChevronRightIcon,
} from '@heroicons/react/20/solid'
import RetryImage from '@components/RetryImage'
import Detailed from '@components/Poster/Detailed'
import MediaPoster from '@components/MediaPoster'
import { SEARCH_KINDS, isPlaceholder } from './useSearchResults'

const KIND_LABELS = { movie: 'Movies', tv: 'TV Shows' }

/**
 * Movies, TV Shows or both (the default). The last one left on can't be
 * turned off, so there is always something to search; pressing one keeps the
 * focus in the search box, so typing carries on.
 */
const KindFilter = ({ types, setTypes }) => (
  <div role="group" aria-label="Show" className="flex items-center gap-2 border-b border-gray-100 px-4 py-2">
    {SEARCH_KINDS.map((kind) => {
      const on = types.includes(kind)
      const onlyOne = on && types.length === 1
      return (
        <button
          key={kind}
          type="button"
          aria-pressed={on}
          aria-disabled={onlyOne || undefined}
          title={onlyOne ? 'At least one stays on' : undefined}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (onlyOne) return
            setTypes(SEARCH_KINDS.filter((k) => (k === kind ? !on : types.includes(k))))
          }}
          className={classNames(
            'rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset transition-colors',
            on ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-gray-600 ring-gray-300 hover:bg-gray-50',
            onlyOne && 'cursor-not-allowed'
          )}
        >
          {KIND_LABELS[kind]}
        </button>
      )
    })}
  </div>
)

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
 * How long a placeholder row stays on screen before it asks for its page. The
 * virtual list renders only the rows near the viewport, so a row on screen
 * means its page is wanted; the wait keeps a fast scroll or a scrollbar drag
 * from fetching every page it passes.
 */
export const REQUEST_AFTER_SHOWN_MS = 150

/** The combobox's selection stays empty: choosing an option opens it through its link. */
const keepNoSelection = () => {}

/** A result whose page hasn't arrived: a grey row that asks for its page once it has stayed in view. */
const PlaceholderRow = ({ page, onRequestPage }) => {
  useEffect(() => {
    const timer = setTimeout(() => onRequestPage(page), REQUEST_AFTER_SHOWN_MS)
    return () => clearTimeout(timer)
  }, [page, onRequestPage])

  return (
    <div className="flex items-center w-full min-w-0" aria-hidden="true">
      <div className="flex-shrink-0 rounded-lg bg-gray-200 animate-pulse" style={{ width: '32px', height: '48px' }} />
      <div className="ml-3 flex flex-col flex-1 gap-2">
        <span className="h-3 w-2/3 rounded bg-gray-200 animate-pulse" />
        <span className="h-2 w-1/4 rounded bg-gray-100 animate-pulse" />
      </div>
    </div>
  )
}

/**
 * SearchModal with HeadlessUI v2 + React 19.2 best practices
 *
 * Features:
 * - HeadlessUI v2 native virtualization (powered by TanStack Virtual)
 * - React 18/19.2 hooks: useId, useMemo, useCallback, memo
 * - React 19.2 ErrorBoundary pattern
 * - React 19.2 Activity component for smooth detail panel transitions
 * - Optimal performance for all list sizes
 * - The list has a slot for every result (useSearchResults), so its scrollbar
 *   stands for all of them; placeholder slots fill in a page at a time as they
 *   come into view, and can't be focused or chosen
 */
const SearchModal = ({
  open,
  setOpen,
  query,
  setQuery,
  types,
  setTypes,
  isLoading,
  failed,
  onRetry,
  options,
  onRequestPage,
}) => {
  // React 18/19 best practice: SSR-safe ID generation
  const searchInputId = useId()

  // Stable callback reference
  const handleClose = useCallback(() => setOpen(false), [setOpen])

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
                {/* HeadlessUI v2: Always use virtualization for optimal performance */}
                {/*
                  No selection is kept (value null; an option opens through its
                  link). Headless UI rewrites the input from the selection
                  whenever the combobox closes, which a click anywhere outside
                  the input and list does (the filter, the detail pane): without
                  a value and displayValue it wrote "", blanking the typed query
                  until the next render put it back.
                */}
                <Combobox value={null} onChange={keepNoSelection} virtual={{ options, disabled: isPlaceholder }}>
                  {({ activeOption }) => (
                    <>
                      {/* Search input */}
                      <div className="relative border-b border-gray-100">
                        <MagnifyingGlassIcon
                          className="pointer-events-none absolute left-4 top-3.5 h-5 w-5 text-gray-400"
                          aria-hidden="true"
                        />
                        <ComboboxInput
                          className="h-12 w-full border-0 bg-transparent pl-11 pr-4 text-gray-900 placeholder:text-gray-400 focus:ring-0 sm:text-sm"
                          placeholder="Search..."
                          id={searchInputId}
                          value={query}
                          displayValue={() => query}
                          onChange={(event) => setQuery(event.target.value)}
                        />
                        <XMarkIcon
                          className="p-1.5 rounded-full absolute right-4 top-[0.55rem] h-[2.05rem] w-[2.05rem] text-gray-400 hover:text-gray-500 focus:text-gray-500 cursor-pointer"
                          onClick={handleClose}
                        />
                      </div>
                      <KindFilter types={types} setTypes={setTypes} />

                      {failed ? (
                        <div className="px-6 py-14 text-center text-sm sm:px-14" role="alert">
                          <p className="font-semibold text-gray-900">Couldn't load search results</p>
                          <button
                            type="button"
                            onClick={onRetry}
                            className="mt-4 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
                          >
                            Try again
                          </button>
                        </div>
                      ) : isLoading ? (
                        <Loading fullscreenClasses="" />
                      ) : (query === '' || options.length > 0) ? (
                        /* Two-pane flex layout with fixed height */
                        <div className="flex divide-x divide-gray-100 h-[42rem] max-h-[80vh]">
                          {/* Left pane: Header + Options list */}
                          <div className="min-w-0 flex-auto flex flex-col">
                            {/* Header outside ComboboxOptions */}
                            {query === '' && (
                              <div className="px-6 pt-4">
                                <h2 className="text-xs font-semibold text-gray-500">
                                  Recent additions
                                </h2>
                              </div>
                            )}

                            {/* HeadlessUI v2 Virtual: ComboboxOptions with hold prop */}
                            <ComboboxOptions
                              static
                              hold
                              className={classNames(
                                'flex-1 overflow-y-auto px-6 py-4 text-sm text-gray-700',
                                query === '' && 'pt-2'
                              )}
                            >
                              {/* Render prop function - MUST be ONLY child of ComboboxOptions */}
                              {({ option: media }) =>
                                isPlaceholder(media) ? (
                                  <ComboboxOption
                                    value={media}
                                    aria-label="Loading"
                                    className="-mx-2 flex cursor-default select-none items-center rounded-md p-2 h-16 w-full max-w-full"
                                  >
                                    <PlaceholderRow page={media.page} onRequestPage={onRequestPage} />
                                  </ComboboxOption>
                                ) : (
                                <ComboboxOption
                                  value={media}
                                  className="-mx-2 flex cursor-default select-none items-center rounded-md p-2 h-16 data-[focus]:bg-gray-100 data-[focus]:text-gray-900 w-full max-w-full"
                                >
                                  <Link
                                    href={buildURL(media.url)}
                                    className="flex items-center w-full min-w-0 group"
                                    onClick={handleClose}
                                  >
                                    <div
                                      className="relative flex-shrink-0 rounded-lg overflow-hidden bg-gray-200"
                                      style={{ width: '32px', height: '48px' }}
                                    >
                                      <RetryImage
                                        src={media.posterURL}
                                        fill
                                        sizes="32px"
                                        alt={media.title}
                                        className="object-cover"
                                        //loading="lazy"
                                        placeholder="blur"
                                        blurDataURL={media.posterBlurhash ? `data:image/png;base64,${media.posterBlurhash}` : undefined}
                                        // Remove loading prop entirely or use eager
                                        // priority
                                      />
                                    </div>
                                    <div className="ml-3 flex flex-col flex-1 min-w-0">
                                      <span className="truncate block">{media.title}</span>
                                      <span className="text-gray-400 text-xs truncate block">
                                        ↳{' '}
                                        {media.type === 'movie'
                                          ? 'Movie'
                                          : media.type === 'tv'
                                          ? 'TV Show'
                                          : 'TV Episode'}
                                      </span>
                                    </div>
                                    <ChevronRightIcon
                                      className="ml-3 h-5 w-5 flex-shrink-0 text-gray-400 opacity-0 group-data-[focus]:opacity-100"
                                      aria-hidden="true"
                                    />
                                  </Link>
                                </ComboboxOption>
                                )
                              }
                            </ComboboxOptions>
                          </div>

                          <div className="hidden w-1/2 flex-none flex-col overflow-hidden sm:flex">
                            <div
                              className="flex-1 p-6 text-center overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100"
                              style={{
                                maxHeight: 'calc(80vh - 100px)',
                              }}
                            >
                              {activeOption &&
                                (activeOption?.type === 'tv' ? (
                                  <div key={activeOption.id || activeOption.url}>
                                  <Detailed
                                    tvShow={activeOption}
                                    contClassName={'w-auto max-w-[280px] mb-4'}
                                    posterOnly={true}
                                    hideGenres={false}
                                    size={{ w: 400, h: 600 }}
                                    quality={100}
                                    loadingType={'eager'}
                                    contClassNamePoster=""
                                    check4kandHDR={true}
                                  />
                                    {activeOption.metadata?.tagline && (
                                      <p className="text-sm italic text-gray-500">
                                        "{activeOption.metadata.tagline}"
                                      </p>
                                    )}
                                    <h2 className="text-lg font-semibold text-gray-900">
                                      {activeOption.title}
                                    </h2>
                                    {activeOption.release_date && (
                                      <p className="text-sm text-gray-500">
                                        Released: {new Date(activeOption.release_date).getDate()}
                                      </p>
                                    )}
                                    {activeOption.metadata?.overview && (
                                      <p className="text-sm leading-6 text-gray-500 line-clamp-4">
                                        {activeOption.metadata.overview}
                                      </p>
                                    )}
                                  </div>
                                ) : activeOption?.type === 'movie' ? (
                                  <div className="space-y-3" key={activeOption.id || activeOption.url}>
                                    <MediaPoster
                                      movie={activeOption}
                                      imagePriority={true}
                                      className='max-w-[280px]'
                                      contClassName="max-w-[280px] mx-auto"
                                      size={{ w: 400, h: 600 }}
                                      quality={100}
                                    />
                                    {activeOption.tagline && (
                                      <p className="text-sm italic text-gray-500">
                                        "{activeOption.tagline}"
                                      </p>
                                    )}
                                    <h2 className="text-lg font-semibold text-gray-900">
                                      {activeOption.title}
                                    </h2>
                                    {activeOption.release_date && (
                                      <p className="text-sm text-gray-500">
                                        Released: {new Date(activeOption.release_date).getDate()}
                                      </p>
                                    )}
                                    {activeOption.metadata?.overview && (
                                      <p className="text-sm leading-6 text-gray-500 line-clamp-4">
                                        {activeOption.metadata.overview}
                                      </p>
                                    )}
                                  </div>
                                ) : (
                                  <div className="space-y-3" key={activeOption.id || activeOption.url}>
                                    <MediaPoster
                                      tv={activeOption}
                                      imagePriority={true}
                                      size={{ w: 400, h: 600 }}
                                      quality={100}
                                    />
                                    <h2 className="text-lg font-semibold text-gray-900">
                                      {activeOption?.title}
                                    </h2>
                                    {activeOption?.description && (
                                      <p className="text-sm leading-6 text-gray-500 line-clamp-4">
                                        {activeOption.description}
                                      </p>
                                    )}
                                  </div>
                                ))}
                            </div>
                            {activeOption && (
                              <div className="flex-none p-4 border-t border-gray-100 bg-white">
                                <Link
                                  href={buildURL(activeOption.url)}
                                  type="button"
                                  className="w-full rounded-md bg-indigo-600 px-3 py-2 text-center text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                                  onClick={handleClose}
                                >
                                  Open this
                                </Link>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : null}

                      {query !== '' && options.length === 0 && !isLoading && !failed && (
                        <div className="px-6 py-14 text-center text-sm sm:px-14">
                          <UsersIcon className="mx-auto h-6 w-6 text-gray-400" aria-hidden="true" />
                          <p className="mt-4 font-semibold text-gray-900">
                            Nothing found for that query
                          </p>
                          <p className="mt-2 text-gray-500">
                            We couldn't find anything with that query. Please try again.
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </Combobox>
              </ErrorBoundary>
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  )
}

export default memo(SearchModal)
