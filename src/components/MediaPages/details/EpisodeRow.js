'use client'

import Link from 'next/link'
import { ViewTransition } from 'react'
import { CheckIcon, EllipsisHorizontalIcon } from '@heroicons/react/20/solid'
import { classNames } from '@src/utils'
import useLiveProgress from '@components/WatchProgress/useLiveProgress'
import ProgressBar from '@components/WatchProgress/ProgressBar'
import { formatRuntime } from '@components/WatchProgress/progress'
import { episodeStatusLine } from '@components/WatchProgress/episodeStatus'
import { Chip } from './Primitives'
import EpisodeThumbnail from './EpisodeThumbnail'

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300'

const STATUS_CLASSES = {
  'in-progress': 'text-blue-300',
  unwatched: 'text-blue-300/60',
  watched: 'text-emerald-300',
}

/** What a row says where the synopsis would be, when TMDB has none (507 episodes). */
export const SYNOPSIS_PLACEHOLDER = 'Episode synopsis will appear here.'

/**
 * @typedef {Object} EpisodeRowData
 * Plain JSON the season page builds for each row.
 * @property {string} _id
 * @property {string|null} showId
 * @property {number} seasonNumber
 * @property {number} episodeNumber
 * @property {string} title
 * @property {string|null} overview
 * @property {string|null} thumbnail
 * @property {string|null} thumbnailBlurDataURL - a complete `data:` URL
 * @property {number|null} durationMs
 * @property {string|null} videoURL
 * @property {string|null} mediaId - durable 'mid:…' identity, or null
 * @property {string[]} chips - quality chips plus 'CC'
 * @property {{ info: string, play: string }} hrefs
 * @property {Object} watchHistory - the server's watch-history object
 * @property {string} viewTransitionName
 */

/**
 * One episode of a season, as a list row or a grid card.
 *
 * The row is a client component because its status line and the bar under
 * the still are live: the server's `watchHistory` seeds them, and the local
 * mirror keeps them moving while the episode plays elsewhere. The title link
 * is the row's one tab stop; the still links too, for the pointer, but is
 * hidden from the tab order and assistive tech so the row is not two links.
 *
 * @param {{ episode: EpisodeRowData, view?: 'list'|'grid', onActions: (episode: EpisodeRowData) => void }} props
 */
export default function EpisodeRow({ episode, view = 'list', onActions }) {
  const progress = useLiveProgress({
    watchHistory: episode.watchHistory,
    mediaId: episode.mediaId,
    videoURL: episode.videoURL,
    durationMs: episode.durationMs,
  })
  const status = episodeStatusLine(progress)
  const runtime = formatRuntime(episode.durationMs)
  const titleText = `${episode.episodeNumber}. ${episode.title}`

  const thumbnail = (
    <Link href={episode.hrefs.info} tabIndex={-1} aria-hidden="true" className="block">
      <ViewTransition name={episode.viewTransitionName}>
        <EpisodeThumbnail src={episode.thumbnail} blurDataURL={episode.thumbnailBlurDataURL} alt="">
          {progress.hasProgress && !progress.completed ? (
            <ProgressBar progressPercent={progress.progressPercent} completed={progress.completed} className="absolute inset-x-0 bottom-0 h-1" />
          ) : null}
        </EpisodeThumbnail>
      </ViewTransition>
    </Link>
  )

  const statusLine = (
    <span className={classNames('inline-flex items-center gap-1 font-medium', STATUS_CLASSES[status.kind])}>
      {status.kind === 'watched' ? <CheckIcon className="size-4" aria-hidden="true" /> : null}
      {status.label}
    </span>
  )

  const chips = (episode.chips || []).map((chip) => <Chip key={chip}>{chip}</Chip>)

  const actions = (
    <button
      type="button"
      aria-label="Episode actions"
      onClick={() => onActions?.(episode)}
      className={classNames('flex size-11 items-center justify-center rounded-md text-white/60 hover:bg-white/10 hover:text-white', FOCUS_RING)}
    >
      <EllipsisHorizontalIcon className="size-5" aria-hidden="true" />
    </button>
  )

  if (view === 'grid') {
    return (
      <li className="flex flex-col gap-2">
        {thumbnail}
        <Link href={episode.hrefs.info} className={classNames('font-semibold text-white hover:underline rounded', FOCUS_RING)}>
          {titleText}
        </Link>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          {statusLine}
          {chips}
        </p>
        <div className="flex items-center justify-between">
          {runtime ? <span className="text-sm tabular-nums text-white/60">{runtime}</span> : <span />}
          {actions}
        </div>
      </li>
    )
  }

  return (
    <li className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-x-4 gap-y-3 border-b border-white/10 py-5 last:border-b-0 sm:grid-cols-[2.5rem_minmax(0,220px)_1fr_auto]">
      <span className="pt-0.5 text-sm tabular-nums text-white/40">{String(episode.episodeNumber).padStart(2, '0')}</span>
      <div className="max-w-[220px]">{thumbnail}</div>
      <div className="col-start-2 min-w-0 sm:col-start-auto">
        <Link href={episode.hrefs.info} className={classNames('font-semibold text-white hover:underline rounded', FOCUS_RING)}>
          {titleText}
        </Link>
        {episode.overview ? (
          <p className="mt-1 text-sm leading-relaxed text-white/70 line-clamp-3">{episode.overview}</p>
        ) : (
          <p className="mt-1 text-sm italic text-white/40">{SYNOPSIS_PLACEHOLDER}</p>
        )}
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          {statusLine}
          {chips}
        </p>
      </div>
      <div className="col-start-2 flex items-center gap-3 sm:col-start-auto sm:justify-self-end">
        {runtime ? <span className="text-sm tabular-nums text-white/60">{runtime}</span> : null}
        {actions}
      </div>
    </li>
  )
}
