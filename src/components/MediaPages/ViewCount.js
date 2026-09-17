import { EyeIcon } from '@heroicons/react/20/solid'
import { classNames } from '@src/utils'
import { countUniqueViewersByNormalizedId } from '@src/utils/flatDatabaseUtils'
import { FactRow } from './details/Primitives'

/**
 * "Watched by N people" — distinct viewers across every identity the title
 * has had (URL hash and durable mediaId). An async server component; it
 * lives inside the cached details subtree, so the count is shared by
 * everyone and refreshes with the page cache.
 */
export default async function ViewCount({ normalizedVideoId, mediaId = null }) {
  const uniqueWatches = await countUniqueViewersByNormalizedId(normalizedVideoId, mediaId)

  if (!uniqueWatches) return null

  return (
    <span className="ml-auto text-sm text-gray-100">
      <EyeIcon className="w-[17px] inline" /> Watched by {uniqueWatches} {uniqueWatches === 1 ? 'person' : 'people'}
    </span>
  )
}

/**
 * The same count as a row of the details panel, or nothing when no one has
 * watched it yet (a "0 people" row says less than its absence).
 */
export async function WatchedByRow({ normalizedVideoId, mediaId = null }) {
  const uniqueWatches = await countUniqueViewersByNormalizedId(normalizedVideoId, mediaId)

  if (!uniqueWatches) return null

  return (
    <FactRow label="Watched by">
      <span className="inline-flex items-center gap-1.5">
        <EyeIcon className="size-4 text-white/50" aria-hidden="true" />
        {uniqueWatches} {uniqueWatches === 1 ? 'person' : 'people'}
      </span>
    </FactRow>
  )
}

/**
 * The same count as one muted line, for under the episode page's still.
 * Block-level (`flex`), so `justify-end` in `className` right-aligns it.
 * Nothing when no one has watched it yet.
 *
 * @param {{ normalizedVideoId: string, mediaId?: string|null, className?: string }} props
 */
export async function WatchedByLine({ normalizedVideoId, mediaId = null, className = '' }) {
  const uniqueWatches = await countUniqueViewersByNormalizedId(normalizedVideoId, mediaId)

  if (!uniqueWatches) return null

  return (
    <p className={classNames('flex items-center gap-1.5 text-sm text-white/55', className)}>
      <EyeIcon className="size-4" aria-hidden="true" />
      Watched by {uniqueWatches} {uniqueWatches === 1 ? 'person' : 'people'}
    </p>
  )
}
