import React, { memo } from 'react'
import Link from 'next/link'
import Detailed from '@components/Poster/Detailed'
import MediaPoster from '@components/MediaPoster'
import { buildURL } from '@src/utils'

/**
 * Memoized detail panel component for search modal
 * Following React 18/19.2 best practices for performance
 * Prevents unnecessary re-renders when activeOption hasn't changed
 */
const DetailPanel = memo(({ activeOption, onClose }) => {
  if (!activeOption) return null

  return (
    <div className="hidden max-h-[80vh] w-1/2 flex-none flex-col overflow-hidden sm:flex">
      <div 
        className="flex-1 p-6 text-center overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100"
        style={{
          maxHeight: 'calc(80vh - 100px)',
        }}
      >
        {activeOption.type === 'tv' ? (
          <Detailed
            tvShow={activeOption}
            contClassName={'w-auto max-w-sm'}
            posterOnly={true}
            hideGenres={false}
            size={{ w: 400, h: 600 }}
            quality={100}
            loadingType={'eager'}
            contClassNamePoster=""
            check4kandHDR={true}
          />
        ) : activeOption.type === 'movie' ? (
          <div className="space-y-3">
            <MediaPoster
              movie={activeOption}
              imagePriority={true}
              contClassNamePoster="mx-auto"
              size={{ w: 400, h: 600 }}
              quality={100}
            />
            <h2 className="text-lg font-semibold text-gray-900">
              {activeOption.title}
            </h2>
            {activeOption.description && (
              <p className="text-sm leading-6 text-gray-500 line-clamp-4">
                {activeOption.description}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <MediaPoster
              tv={activeOption}
              imagePriority={true}
              size={{ w: 400, h: 600 }}
              quality={90}
            />
            <h2 className="text-lg font-semibold text-gray-900">
              {activeOption.title}
            </h2>
            {activeOption.description && (
              <p className="text-sm leading-6 text-gray-500 line-clamp-4">
                {activeOption.description}
              </p>
            )}
          </div>
        )}
      </div>
      <div className="flex-none p-4 border-t border-gray-100 bg-white">
        <Link
          href={buildURL(activeOption.url)}
          type="button"
          className="w-full rounded-md bg-indigo-600 px-3 py-2 text-center text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          onClick={onClose}
        >
          Open this
        </Link>
      </div>
    </div>
  )
}, (prevProps, nextProps) => {
  // Only re-render if activeOption title changes (indicates different media)
  return prevProps.activeOption?.title === nextProps.activeOption?.title
})

DetailPanel.displayName = 'DetailPanel'

export default DetailPanel