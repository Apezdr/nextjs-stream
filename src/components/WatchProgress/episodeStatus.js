/**
 * The one-line standing of an episode in a season list: "Watched",
 * "In progress · 56m left", "Not watched". Pure, so the rows and their
 * tests agree with the rest of the progress vocabulary (formatRemaining).
 */

import { formatRemaining } from './progress'

/**
 * @param {{ completed?: boolean, hasProgress?: boolean, remainingSeconds?: number|null, progressPercent?: number }} progress - a readProgress-shaped reading
 * @returns {{ kind: 'watched'|'in-progress'|'unwatched', label: string }}
 */
export function episodeStatusLine(progress) {
  if (progress?.completed) return { kind: 'watched', label: 'Watched' }
  if (progress?.hasProgress) {
    const rest =
      progress.remainingSeconds != null ? formatRemaining(progress.remainingSeconds) : `${Math.round(progress.progressPercent || 0)}%`
    return { kind: 'in-progress', label: `In progress · ${rest}` }
  }
  return { kind: 'unwatched', label: 'Not watched' }
}
