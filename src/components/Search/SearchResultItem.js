import React, { memo } from 'react'
import { ComboboxOption } from '@headlessui/react'
import { ChevronRightIcon } from '@heroicons/react/20/solid'
import Link from 'next/link'
import RetryImage from '@components/RetryImage'
import { buildURL, classNames } from '@src/utils'

/**
 * Memoized search result item component
 * Following React 18/19.2 best practices for performance
 */
const SearchResultItem = memo(({ media, onClose, index }) => {
  return (
    <ComboboxOption
      value={media}
      className={({ focus }) =>
        classNames(
          'flex cursor-default select-none items-center rounded-md p-2',
          focus && 'bg-gray-100 text-gray-900'
        )
      }
    >
      <Link
        href={buildURL(media.url)}
        className="flex items-center w-full"
        onClick={onClose}
      >
        <RetryImage
          src={media.posterURL}
          loading="lazy"
          width={32}
          height={48}
          alt={media.title}
          className="h-12 w-8 flex-none rounded-lg"
        />
        <div className="ml-3 flex flex-col truncate flex-1">
          <span>{media.title}</span>
          <span className="text-gray-400 text-xs">
            ↳{' '}
            {media.type === 'movie'
              ? 'Movie'
              : media.type === 'tv'
                ? 'TV Show'
                : 'TV Episode'}
          </span>
        </div>
        <ChevronRightIcon
          className="ml-3 h-5 w-5 flex-none text-gray-400"
          aria-hidden="true"
        />
      </Link>
    </ComboboxOption>
  )
}, (prevProps, nextProps) => {
  // Custom comparison for better memoization
  return (
    prevProps.media.title === nextProps.media.title &&
    prevProps.media.posterURL === nextProps.media.posterURL &&
    prevProps.index === nextProps.index
  )
})

SearchResultItem.displayName = 'SearchResultItem'

export default SearchResultItem