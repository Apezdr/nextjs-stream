import Link from 'next/link'
import { ArrowRightIcon } from '@heroicons/react/20/solid'
import { classNames } from '@src/utils'
import { formatRuntime } from '@components/WatchProgress/progress'
import { SectionHeading } from './Primitives'
import EpisodeThumbnail from './EpisodeThumbnail'

/**
 * "Next in Season 1": the card under the episode page's surface that leads
 * to the next episode's info page — its still, "EPISODE 2", the title and
 * "49m · 1080p". Nothing without a next episode.
 *
 * @param {Object} props
 * @param {string|null} props.href
 * @param {number} props.seasonNumber
 * @param {number} props.episodeNumber
 * @param {string|null} props.title
 * @param {string|null} props.thumbnail
 * @param {string|null} [props.blurDataURL] - a complete `data:` URL, or null
 * @param {number|null} [props.durationMs]
 * @param {string[]} [props.chips]
 * @param {string} [props.className]
 */
export default function NextEpisodeCard({
  href,
  seasonNumber,
  episodeNumber,
  title,
  thumbnail,
  blurDataURL = null,
  durationMs = null,
  chips = [],
  className = '',
}) {
  if (!href) return null

  const name = title || `Episode ${episodeNumber}`
  const meta = [formatRuntime(durationMs), ...(chips || [])].filter(Boolean).join(' · ')

  return (
    <section aria-labelledby="next-episode-heading" className={className || undefined}>
      <SectionHeading id="next-episode-heading">Next in {seasonNumber === 0 ? 'Specials' : `Season ${seasonNumber}`}</SectionHeading>
      <Link
        href={href}
        aria-label={`Episode ${episodeNumber}: ${name}`}
        className={classNames(
          'flex flex-col gap-4 rounded-xl bg-white/5 p-4 ring-1 ring-white/10 transition-colors hover:bg-white/10 sm:flex-row',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300'
        )}
      >
        <EpisodeThumbnail src={thumbnail} blurDataURL={blurDataURL} className="w-full shrink-0 sm:w-[180px]" sizes="(max-width: 640px) 100vw, 180px" />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/60">Episode {episodeNumber}</p>
          <p className="mt-1 inline-flex items-center gap-1 text-base font-semibold text-white">
            {name}
            <ArrowRightIcon className="size-4" aria-hidden="true" />
          </p>
          {meta ? <p className="mt-1 text-sm text-white/55">{meta}</p> : null}
        </div>
      </Link>
    </section>
  )
}
