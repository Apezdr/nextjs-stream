import { formatDate } from '@src/utils'

/**
 * The watchlist search lists library titles ("Available in Media Server")
 * apart from TMDB-only ones ("Add from TMDB"). Which TMDB results the library
 * holds used to be guessed from the first page of the library search, so on a
 * broad query a library title further down showed as TMDB-only, with "Send to
 * Radarr/Sonarr" offered for something already here. The server now answers
 * it per TMDB id (POST /api/authenticated/media/in-library), by the same rule
 * an added item resolves with.
 */

/** TMDB ids repeat across movies and TV, so a title is its type and id. */
export const titleKey = (mediaType, tmdbId) => `${mediaType}-${tmdbId}`

/**
 * Which of these TMDB results the library holds, by titleKey. Throws when the
 * lookup fails: without it, library titles would be offered as TMDB-only.
 * @param {Array<{ id: number, media_type: 'movie'|'tv' }>} tmdbResults
 * @returns {Promise<Map<string, { id: string, title: string, posterURL: string|null }>>}
 */
export async function fetchLibraryMatches(tmdbResults) {
  const asked = new Map(tmdbResults.map((item) => [titleKey(item.media_type, item.id), item]))
  if (asked.size === 0) return new Map()
  const response = await fetch('/api/authenticated/media/in-library', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [...asked.values()].map((item) => ({ tmdbId: item.id, mediaType: item.media_type })) }),
  })
  if (!response.ok) {
    throw new Error(`Library lookup failed: HTTP ${response.status}`)
  }
  const { items } = await response.json()
  return new Map(items.map((match) => [titleKey(match.mediaType, match.tmdbId), match]))
}

/**
 * Whether a search result may be offered for this playlist: not already in it
 * by type and TMDB id, by library id, or by title and type.
 * @param {Array<{ tmdbId?: number, mediaId?: string, title?: string, mediaType: string }>} playlistItems
 * @returns {(result: { key: string, mediaId?: string, title?: string, mediaType: string }) => boolean}
 */
export function notInPlaylist(playlistItems) {
  const keys = new Set(playlistItems.filter((item) => item.tmdbId).map((item) => titleKey(item.mediaType, item.tmdbId)))
  const mediaIds = new Set(playlistItems.map((item) => item.mediaId).filter(Boolean))
  const titles = new Set(playlistItems.map((item) => `${item.title?.toLowerCase()}-${item.mediaType}`))
  return ({ key, mediaId, title, mediaType }) =>
    !keys.has(key) && !(mediaId && mediaIds.has(mediaId)) && !titles.has(`${title?.toLowerCase()}-${mediaType}`)
}

/**
 * TMDB results split into library titles (shaped like the library search's
 * results, so the list shows them the same way) and TMDB-only ones. A result
 * already in `shownKeys` is skipped, and every result kept is added to it, so
 * later pages never repeat a title.
 * @returns {{ internal: object[], external: object[] }}
 */
export function splitTmdbResults({ tmdbResults, libraryMatches, keep, shownKeys }) {
  const internal = []
  const external = []
  for (const item of tmdbResults) {
    const key = titleKey(item.media_type, item.id)
    if (shownKeys.has(key)) continue
    const match = libraryMatches.get(key)
    const title = match?.title ?? item.title ?? item.name
    if (!keep({ key, mediaId: match?.id, title, mediaType: item.media_type })) continue
    shownKeys.add(key)
    if (!match) {
      external.push(item)
      continue
    }
    internal.push({
      id: item.id,
      title,
      media_type: item.media_type,
      poster_path: match.posterURL,
      release_date: formatDate(item.release_date),
      first_air_date: formatDate(item.first_air_date),
      overview: item.overview,
      isInternalMedia: true,
      internalMediaId: match.id,
    })
  }
  return { internal, external }
}
