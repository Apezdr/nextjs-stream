'use client'

import { classNames } from '@src/utils'

/**
 * The bar the TV and mobile apps draw under a poster: a dim full-width track
 * with a blue fill, green once the title counts as watched. Sized by the
 * caller; this only paints.
 *
 * @param {{ progressPercent: number, completed?: boolean, className?: string, trackClassName?: string, label?: string }} props
 */
export default function ProgressBar({ progressPercent, completed = false, className = '', trackClassName = '', label }) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(progressPercent) ? progressPercent : 0))
  return (
    <div
      className={classNames('w-full overflow-hidden', trackClassName || 'bg-black/40', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label || (completed ? 'Watched' : 'Watch progress')}
    >
      <div
        className={classNames('h-full transition-[width] duration-300', completed ? 'bg-green-500' : 'bg-blue-500')}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
