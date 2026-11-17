'use client'

import { classNames } from '@src/utils'

/**
 * A card as the Watch History row shows it while the date strip's handle is
 * moving: the title and date on a plain tile. It carries no image and asks
 * the network for nothing, so a drag can pass hundreds of them. The real card
 * (poster, progress, popup) takes its place once the handle rests. Same box
 * as Card, so nothing shifts on the swap.
 */
export default function ScrubCard({ item, isPeek = false }) {
  return (
    <div
      className={classNames('w-32 flex-shrink-0 sm:w-36 lg:w-48', isPeek ? 'scale-95 opacity-50' : '')}
      aria-hidden="true"
      data-testid="scrub-card"
    >
      <div className="relative h-72 w-full overflow-hidden rounded-lg bg-slate-800">
        {item.seasonNumber ? (
          <div className="absolute bottom-2 left-2 right-2">
            <div className="flex flex-row justify-center gap-1 rounded-xl bg-gray-200 bg-opacity-20 px-2 py-1">
              <span className="text-xs text-slate-800">S{item.seasonNumber}</span>
              <span className="text-xs">|</span>
              <span className="text-xs font-bold">E{item.episodeNumber}</span>
            </div>
          </div>
        ) : null}
      </div>
      <div className="mt-2 w-full text-center">
        <div className="truncate text-sm">{item.title}</div>
        {item.lastWatchedDate ? (
          <>
            <div className="text-xs font-medium text-blue-300">Last Watched:</div>
            <div className="truncate text-[10px] text-white">{item.lastWatchedDate}</div>
          </>
        ) : null}
      </div>
    </div>
  )
}
