import Link from 'next/link'
import { ArrowLeftIcon, ArrowRightIcon } from '@heroicons/react/20/solid'
import { classNames } from '@src/utils'

const LINK_CLASSES = 'rounded text-blue-300 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300'

/**
 * "← Previous episode | All 10 episodes | Next episode · Title →" between
 * the episode hero and the surface. Each of the three cells is always
 * rendered (a disabled "Previous", an empty span) so the middle link stays
 * centred; nothing at all when the page has none of the three (a viewer with
 * limited access sees show-level trailer media with no neighbours).
 *
 * @param {Object} props
 * @param {{ href: string, episodeNumber: number, title?: string|null }|null} props.previous
 * @param {{ href: string, count: number }|null} props.all - the season page and how many episodes it lists
 * @param {{ href: string, episodeNumber: number, title?: string|null }|null} props.next
 * @param {string} [props.className]
 */
export default function EpisodeNav({ previous, all, next, className = '' }) {
  if (!previous && !next && !all) return null

  return (
    <nav aria-label="Episode navigation" className={classNames('grid grid-cols-3 items-center gap-4 py-4 text-sm', className)}>
      {previous ? (
        <Link href={previous.href} className={classNames('inline-flex items-center gap-1', LINK_CLASSES)}>
          <ArrowLeftIcon className="size-4 shrink-0" aria-hidden="true" />
          Previous episode
        </Link>
      ) : (
        <span aria-disabled="true" className="inline-flex items-center gap-1 text-white/30">
          <ArrowLeftIcon className="size-4 shrink-0" aria-hidden="true" />
          Previous episode
        </span>
      )}
      {all ? (
        <Link href={all.href} className="justify-self-center rounded text-white/70 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300">
          All {all.count} episode{all.count === 1 ? '' : 's'}
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link href={next.href} className={classNames('inline-flex min-w-0 items-center gap-1 justify-self-end', LINK_CLASSES)}>
          <span className="truncate">Next episode · {next.title || `Episode ${next.episodeNumber}`}</span>
          <ArrowRightIcon className="size-4 shrink-0" aria-hidden="true" />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  )
}
