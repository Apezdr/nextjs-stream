import { cacheLife, cacheTag } from 'next/cache'
import { getCachedMediaCounts } from '@src/utils/cache/mediaCounts'
import { formatDuration } from '@src/utils/formatDuration'

// scopeId: the viewer's LibraryAccess.id, part of the cache key
export default async function AsyncMediaCounts({ suffix = '', showDuration = false, scopeId }) {
  'use cache'
  cacheLife('mediaLists')
  cacheTag('media-library', 'media-counts')

  const { count, totalMilliseconds } = await getCachedMediaCounts('all', scopeId)

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
