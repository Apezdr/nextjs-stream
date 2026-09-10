'use client'

import { classNames } from '@src/utils'
import WatchlistButton from '@components/WatchlistButton'
import PrimaryPlayButton from './PrimaryPlayButton'

const SECONDARY_CLASSES =
  'inline-flex h-12 items-center gap-2 rounded-md border border-white/25 px-4 text-sm font-medium text-white transition-colors hover:border-white/50 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300'

/**
 * The button row in the hero: one filled primary, then outline secondaries.
 * On phones the primary spans the row and the secondaries drop to icon
 * buttons beneath it.
 *
 * @param {Object} props
 * @param {string|null} props.videoURL
 * @param {string|null} [props.mediaId]
 * @param {number|null} [props.durationMs]
 * @param {string} props.playHref
 * @param {string|null} [props.trailerUrl]
 * @param {Object|null} [props.watchlist] - props for WatchlistButton, or null to hide it
 * @param {string} [props.className]
 */
export default function ActionRow({ videoURL, mediaId = null, durationMs = null, playHref, trailerUrl = null, watchlist = null, className = '' }) {
  return (
    <div className={classNames('flex flex-wrap items-center gap-3', className)}>
      <PrimaryPlayButton
        videoURL={videoURL}
        mediaId={mediaId}
        durationMs={durationMs}
        playHref={playHref}
        className="w-full sm:w-auto"
      />
      {trailerUrl ? (
        <a
          href={trailerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={SECONDARY_CLASSES}
          aria-label="Watch the trailer on YouTube"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28.57 20" className="size-5" aria-hidden="true">
            <path
              fill="currentColor"
              d="M27.973 3.123A3.578 3.578 0 0 0 25.447.597C23.22 0 14.285 0 14.285 0S5.35 0 3.123.597A3.578 3.578 0 0 0 .597 3.123C0 5.35 0 10 0 10s0 4.65.597 6.877a3.578 3.578 0 0 0 2.526 2.526C5.35 20 14.285 20 14.285 20s8.935 0 11.162-.597a3.578 3.578 0 0 0 2.526-2.526C28.57 14.65 28.57 10 28.57 10s-.002-4.65-.597-6.877Z"
            />
            <path fill="#0b1230" d="M11.425 14.285 18.848 10l-7.423-4.285v8.57Z" />
          </svg>
          <span className="hidden sm:inline">Trailer</span>
        </a>
      ) : null}
      {watchlist ? <WatchlistButton {...watchlist} variant="outline" /> : null}
    </div>
  )
}
