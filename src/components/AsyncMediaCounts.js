import { cacheLife, cacheTag } from 'next/cache'
import { getCachedMediaCounts } from '@src/utils/cache/mediaCounts'
import { formatDuration } from '@src/utils/formatDuration'

// access: the viewer's LibraryAccess, part of the cache key
export default async function AsyncMediaCounts({ suffix = '', showDuration = false, access }) {
  'use cache'
  cacheLife('mediaLists')
  cacheTag('media-library', 'media-counts')

  const { count, totalMilliseconds } = await getCachedMediaCounts('all', access)

  return (
    <span>
      {showDuration && totalMilliseconds > 0 && (
        <span className="block text-sm text-gray-100">
          {formatDuration(totalMilliseconds)} total
        </span>
      )}
      ({count.toLocaleString()})
      {suffix}
    </span>
  )
}
