import IntentPrefetchLink from '@components/MediaPages/IntentPrefetchLink'
import { ViewTransition } from 'react'
import { CheckIcon } from '@heroicons/react/20/solid'
import RetryImage from '@components/RetryImage'
import { classNames } from '@src/utils'

const STATUS_CLASSES = {
  continue: 'text-sm font-medium text-blue-300',
  watched: 'text-sm text-emerald-300',
  partial: 'text-sm text-white/45',
  unwatched: 'text-sm text-white/45',
}

/** The grid is 2 / 3 / 4 across inside the max-w-6xl frame. */
const POSTER_SIZES = '(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 260px'

/**
 * One season in the show page's grid: the poster, "Season 1",
 * "2016 · 10 episodes available" and the viewer's standing in it. A season
 * the library does not have is a dashed frame with its number — no TMDB
 * poster, so what is missing reads as missing — and is not a link.
 *
 * @param {Object} props
 * @param {number} props.seasonNumber
 * @param {string} props.title
 * @param {string|null} props.href - the season page, when available
 * @param {string|null} props.posterURL
 * @param {string|null} props.posterBlurhash - raw base64 PNG; the data URL is built here
 * @param {boolean} props.available
 * @param {string|null} props.year
 * @param {number|null} props.episodeCount
 * @param {{ kind: 'continue'|'watched'|'partial'|'unwatched'|'unavailable', label: string|null }|null} [props.status]
 * @param {string|null} [props.viewTransitionName]
 */
export default function SeasonTile({
  seasonNumber,
  title,
  href,
  posterURL,
  posterBlurhash,
  available,
  year,
  episodeCount,
  status = null,
  viewTransitionName = null,
}) {
  const label = title || (seasonNumber === 0 ? 'Specials' : `Season ${seasonNumber}`)
  const line2 = available
    ? [year, episodeCount != null ? `${episodeCount} episode${episodeCount === 1 ? '' : 's'} available` : null].filter(Boolean).join(' · ') ||
      'Available in your library'
    : 'Missing from your library'
  const statusLabel = available && status?.label ? status.label : null

  const caption = (
    <>
      <p className="mt-3 font-semibold text-white">{label}</p>
      <p className="text-sm text-white/55">{line2}</p>
      {statusLabel ? (
        <p className={classNames('mt-0.5 flex items-center gap-1', STATUS_CLASSES[status.kind] || STATUS_CLASSES.unwatched)}>
          {status.kind === 'watched' ? <CheckIcon className="size-4" aria-hidden="true" /> : null}
          {statusLabel}
        </p>
      ) : null}
    </>
  )

  if (!available || !href) {
    return (
      <div>
        <div className="flex aspect-[2/3] flex-col items-center justify-center rounded-lg border border-dashed border-white/20 text-white/40">
          <span className="text-4xl font-bold">{seasonNumber}</span>
          <span className="text-sm">Not available</span>
        </div>
        {caption}
      </div>
    )
  }

  const placeholder = posterBlurhash ? { placeholder: 'blur', blurDataURL: `data:image/png;base64,${posterBlurhash}` } : {}
  const portrait = (
    <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-white/10 ring-1 ring-white/10 transition-[box-shadow] duration-200 group-hover:ring-2 group-hover:ring-white/40">
      {posterURL ? <RetryImage src={posterURL} alt="" fill sizes={POSTER_SIZES} quality={80} className="object-cover" {...placeholder} /> : null}
    </div>
  )

  return (
    <IntentPrefetchLink
      href={href}
      aria-label={[label, line2, statusLabel].filter(Boolean).join(', ')}
      className="group block rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300"
    >
      {viewTransitionName ? <ViewTransition name={viewTransitionName}>{portrait}</ViewTransition> : portrait}
      {caption}
    </IntentPrefetchLink>
  )
}
