import { EyeIcon } from '@heroicons/react/20/solid'
import { classNames } from '@src/utils'
import { countUniqueViewersByNormalizedId } from '@src/utils/flatDatabaseUtils'
import WatchedByButton from './details/WatchedByButton'

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
 * The same count as one muted line, for under the artwork: the episode
 * page's still and the movie page's poster. Block-level (`flex`), so
 * `justify-end` in `className` right-aligns it. For an admin the count opens
 * the list of who watched (WatchedByButton). Nothing when no one has watched
 * it yet (a "0 people" line says less than its absence).
 *
 * @param {{ normalizedVideoId: string, mediaId?: string|null, durationMs?: number|null, title: string, className?: string, wordsClassName?: string }} props
 */
export async function WatchedByLine({ normalizedVideoId, mediaId = null, durationMs = null, title, className = '', wordsClassName = '' }) {
  const uniqueWatches = await countUniqueViewersByNormalizedId(normalizedVideoId, mediaId)

  if (!uniqueWatches) return null

  return (
    // A div, not a p: the admin dialog mounts inside it
    <div className={classNames('flex text-sm text-white/55', className)}>
      <WatchedByButton
        count={uniqueWatches}
        normalizedVideoId={normalizedVideoId}
        mediaId={mediaId}
        durationMs={durationMs}
        title={title}
        wordsClassName={wordsClassName}
      />
    </div>
  )
}
