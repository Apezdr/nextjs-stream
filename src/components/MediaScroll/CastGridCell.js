'use client'

import { memo, useState } from 'react'
import Link from 'next/link'
import RetryImage from '@components/RetryImage'
import { getFullImageUrl } from '@src/utils'
import { LoadingDots } from '@src/app/loading'

const CastGridCell = memo(({ 
  columnIndex, 
  rowIndex, 
  style, 
  columnCount, 
  castItems
}) => {
  const [isLoading, setIsLoading] = useState(true)
  
  const index = rowIndex * columnCount + columnIndex
  if (index >= castItems.length) return null

  const actor = castItems[index]

  return (
    <div
      style={{
        ...style,
        left: style.left + 16,
        top: style.top + 16,
        width: style.width - 16,
        height: style.height - 16,
      }}
      className="flex flex-col items-center"
    >
      <Link
        href={actor.id ? `https://www.themoviedb.org/person/${actor.id}` : '#'}
        target="_blank"
        className="flex flex-col items-center w-full transition-transform duration-200 transform hover:scale-105 hover:shadow-lg"
      >
        <div className="w-20 h-20 relative rounded-full overflow-hidden bg-gray-200 flex items-center justify-center">
          {isLoading && actor.profile_path && (
            <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-50">
              <LoadingDots />
            </div>
          )}
          {actor.profile_path ? (
            <RetryImage
              src={getFullImageUrl(actor.profile_path)}
              alt={actor.name}
              loading="lazy"
              layout="responsive"
              className="rounded-full"
              width={80}
              height={80}
              quality={40}
              onLoad={() => setIsLoading(false)}
              onError={() => setIsLoading(false)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-500 select-none pointer-events-none">
              N/A
            </div>
          )}
        </div>
        <p className="mt-2 text-center text-sm font-medium text-gray-700">{actor.name}</p>
        {actor.character && (
          <p className="text-center text-xs text-gray-500">as {actor.character}</p>
        )}
      </Link>
    </div>
  )
})

CastGridCell.displayName = 'CastGridCell'

export default CastGridCell
