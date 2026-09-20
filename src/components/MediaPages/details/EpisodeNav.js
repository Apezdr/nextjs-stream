import Link from 'next/link'
import IntentPrefetchLink from '@components/MediaPages/IntentPrefetchLink'
import { ArrowLeftIcon, ArrowRightIcon } from '@heroicons/react/20/solid'
import { classNames } from '@src/utils'
import { formatRuntime } from '@components/WatchProgress/progress'
import EpisodeThumbnail from './EpisodeThumbnail'

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300'

/**
 * One neighbouring episode: a small still, "Previous · Episode 5" and the
 * title on one truncating line. The card is as wide as its column allows
 * and no wider, so a long title ends in an ellipsis instead of pushing the
 * row around.
 */
function Neighbour({ item, direction }) {
  const isNext = direction === 'next'
  const word = isNext ? 'Next' : 'Previous'
  const title = item.title || `Episode ${item.episodeNumber}`
  const runtime = formatRuntime(item.durationMs)
  return (
    <Link
      href={item.href}
      // Stay put: jumping to the top on each step made a change of episode
      // read as a page reload. The row sits under the hero, so the new
      // episode's title and still are already in view.
      scroll={false}
      // Have the neighbour's content ready before the click, not just the page
      // skeleton. It costs one server render per visible link, which is fine
      // for two links and is why the season page's episode rows do NOT do this.
      prefetch={true}
      aria-label={`${word} episode: Episode ${item.episodeNumber}, ${title}`}
      className={classNames(
        'group flex min-w-0 max-w-full items-center gap-3 rounded-lg p-2 transition-colors hover:bg-white/10',
        FOCUS_RING,
        isNext ? 'order-2 flex-row-reverse justify-self-end text-right sm:order-3' : 'order-1 justify-self-start'
      )}
    >
      <EpisodeThumbnail src={item.thumbnail || null} blurDataURL={item.blurDataURL || null} sizes="96px" className="hidden w-24 shrink-0 rounded-md sm:block" />
      <span className="min-w-0">
        <span
          className={classNames(
            'flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.14em] text-blue-300 group-hover:text-white',
            isNext ? 'justify-end' : ''
          )}
        >
          {isNext ? null : <ArrowLeftIcon className="size-4 shrink-0" aria-hidden="true" />}
          <span className="truncate">
            {word} · Episode {item.episodeNumber}
          </span>
          {isNext ? <ArrowRightIcon className="size-4 shrink-0" aria-hidden="true" /> : null}
        </span>
        <span className="mt-0.5 block truncate text-sm font-medium text-white/85">{title}</span>
        {runtime ? <span className="block text-xs text-white/50">{runtime}</span> : null}
      </span>
    </Link>
  )
}

/**
 * The episode page's one way to its neighbours, between the hero and the
 * surface: a card for the previous episode, "All 10 episodes" in the
 * middle, a card for the next. It replaces both the old text row and the
 * "Next in Season N" card at the foot of the page, which did the same job.
 *
 * The side columns are `minmax(0, 1fr)` and the middle is `auto`, so the
 * two cards always get equal room and the middle link stays centred
 * whatever the titles' lengths; a missing neighbour leaves its column
 * empty rather than collapsing it. On phones the two cards share a row and
 * the middle link drops beneath them.
 *
 * Nothing renders when the page has none of the three (a limited-access
 * viewer gets show-level trailer media with no neighbours).
 *
 * @param {Object} props
 * @param {{ href: string, episodeNumber: number, title?: string|null, thumbnail?: string|null, blurDataURL?: string|null, durationMs?: number|null }|null} props.previous
 * @param {{ href: string, count: number }|null} props.all - the season page and how many episodes it lists
 * @param {{ href: string, episodeNumber: number, title?: string|null, thumbnail?: string|null, blurDataURL?: string|null, durationMs?: number|null }|null} props.next
 * @param {string} [props.className]
 */
export default function EpisodeNav({ previous, all, next, className = '' }) {
  if (!previous && !next && !all) return null

  return (
    <nav
      aria-label="Episode navigation"
      className={classNames('grid grid-cols-2 items-center gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]', className)}
    >
      {previous ? <Neighbour item={previous} direction="previous" /> : <span className="order-1" />}
      {all ? (
        <IntentPrefetchLink
          href={all.href}
          className={classNames('order-3 col-span-2 justify-self-center rounded text-sm text-white/70 hover:text-white sm:order-2 sm:col-span-1', FOCUS_RING)}
        >
          All {all.count} episode{all.count === 1 ? '' : 's'}
        </IntentPrefetchLink>
      ) : (
        <span className="order-3 col-span-2 sm:order-2 sm:col-span-1" />
      )}
      {next ? <Neighbour item={next} direction="next" /> : <span className="order-2 sm:order-3" />}
    </nav>
  )
}
