/**
 * What the one primary button on a details page says and where it goes.
 *
 * - Nothing watched yet → "Play", straight to the player.
 * - Part-way through → "Resume", straight to the player (the player applies
 *   the saved position itself).
 * - Finished (server-computed `completed`) → "Watch again", with `?start=0`
 *   so the player restarts instead of landing on the credits.
 *
 * @param {{ progress: { hasProgress?: boolean, completed?: boolean }|null|undefined, playHref: string }} options
 * @returns {{ label: string, href: string, restart: boolean }}
 */
export function primaryAction({ progress, playHref }) {
  if (progress?.completed) return { label: 'Watch again', href: withStartOver(playHref), restart: true }
  if (progress?.hasProgress) return { label: 'Resume', href: playHref, restart: false }
  return { label: 'Play', href: playHref, restart: false }
}

/**
 * The same href with an explicit restart (`?start=0`), whatever query it had.
 */
export function withStartOver(playHref) {
  return playHref.includes('?') ? `${playHref}&start=0` : `${playHref}?start=0`
}
