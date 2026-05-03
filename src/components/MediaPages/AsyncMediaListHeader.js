import { Suspense } from 'react'
import { cacheLife, cacheTag } from 'next/cache'
import { getCachedMediaCounts } from '@src/utils/cache/mediaCounts'
import { formatDuration } from '@src/utils/formatDuration'

const HEADING_CLASS =
  'mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl pb-8 xl:pb-0 px-4 xl:px-0'

const TAGS_BY_TYPE = {
  movies: ['media-library', 'movies', 'movie-count'],
  tv: ['media-library', 'tv', 'tv-show-count'],
  all: ['media-library', 'movies', 'tv', 'media-counts'],
}

function HeaderCountFallback() {
  return (
    <>
      <span className="block text-sm text-gray-100 animate-pulse">&nbsp;</span>
      <span className="animate-pulse opacity-60">(…)</span>
    </>
  )
}

async function MediaCountFragment({ mediaType }) {
  'use cache'
  cacheLife('mediaLists')
  cacheTag(...TAGS_BY_TYPE[mediaType])

  const { count, totalMilliseconds } = await getCachedMediaCounts(mediaType)

  return (
    <>
      {totalMilliseconds > 0 && (
        <span className="block text-sm text-gray-100">
          {formatDuration(totalMilliseconds)} total
        </span>
      )}
      ({count.toLocaleString()})
    </>
  )
}

export default function AsyncMediaListHeader({ mediaType, label }) {
  return (
    <h2 className={HEADING_CLASS}>
      <Suspense fallback={<HeaderCountFallback />}>
        <MediaCountFragment mediaType={mediaType} />
      </Suspense>{' '}
      {label}
    </h2>
  )
}
