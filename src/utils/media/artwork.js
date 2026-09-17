/**
 * Pure helpers behind the artwork viewer: turn TMDB's image lists plus the
 * images a title currently uses into tabs of tiles. No React, no I/O.
 *
 * TMDB's lists come from the app's TMDB proxy (`/images/movie|tv`), each
 * entry `{ file_path, width, height, iso_639_1, vote_average }`. "In use"
 * comes from the title's record: the TMDB path its metadata names and the
 * URL the library actually serves, which may be a custom upload TMDB has
 * never seen.
 */

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/'

/** One tab per kind: where it reads from, and the TMDB size buckets for grid, preview and full view. */
export const ARTWORK_KINDS = [
  { id: 'posters', label: 'Posters', inUseKey: 'poster', thumb: 'w342', preview: 'w780' },
  { id: 'backdrops', label: 'Backdrops', inUseKey: 'backdrop', thumb: 'w500', preview: 'w1280' },
  { id: 'logos', label: 'Logos', inUseKey: 'logo', thumb: 'w300', preview: 'w500' },
]

/**
 * The file name a TMDB path or URL ends in ("/abc.jpg"), which is what
 * identifies an image whatever size bucket or host prefix it carries.
 *
 * @param {string|null|undefined} path - "/abc.jpg" or "https://image.tmdb.org/t/p/original/abc.jpg"
 * @returns {string|null}
 */
export function tmdbFileName(path) {
  if (typeof path !== 'string') return null
  const match = path.trim().match(/\/([^/?#]+\.[a-z0-9]+)(?:[?#].*)?$/i)
  return match ? `/${match[1]}` : null
}

/** English first, then textless, then everything else. */
function languageRank(code) {
  if (code === 'en') return 0
  if (!code) return 1
  return 2
}

/**
 * @typedef {Object} ArtworkItem
 * @property {string} key
 * @property {string} thumb - grid tile URL
 * @property {string} preview - in-dialog preview URL
 * @property {string} full - full-size URL for "Open full size"
 * @property {number|null} width
 * @property {number|null} height
 * @property {string|null} language - ISO 639-1 code, or null for textless
 * @property {boolean} inUse
 * @property {string|null} badge - "In use" (or the caller's label) when inUse
 */

/**
 * Tabs of tiles, the in-use image first in each, then English, textless and
 * other languages, best-rated first within each group. A tab with nothing
 * to show is left out.
 *
 * When the in-use image is not in TMDB's list (a custom upload, or the
 * season poster on a page listing the show's artwork) it becomes a tile of
 * its own from the library URL, so "what is in use" is always answered.
 *
 * @param {Object} options
 * @param {{ posters?: Array, backdrops?: Array, logos?: Array }|null|undefined} options.images
 * @param {{ poster?: { path?: string|null, url?: string|null, label?: string }, backdrop?: Object, logo?: Object }} [options.inUse]
 * @returns {Array<{ id: string, label: string, items: ArtworkItem[] }>}
 */
export function buildArtworkTabs({ images, inUse = {} } = {}) {
  const tabs = []
  for (const kind of ARTWORK_KINDS) {
    const current = inUse?.[kind.inUseKey] || {}
    const currentName = tmdbFileName(current.path)
    const seen = new Set()
    const items = []

    const list = Array.isArray(images?.[kind.id]) ? images[kind.id] : []
    list.forEach((image, position) => {
      const name = tmdbFileName(image?.file_path)
      if (!name || seen.has(name)) return
      seen.add(name)
      const isCurrent = Boolean(currentName) && name === currentName
      items.push({
        key: name,
        thumb: `${TMDB_IMAGE_BASE}${kind.thumb}${name}`,
        preview: `${TMDB_IMAGE_BASE}${kind.preview}${name}`,
        full: `${TMDB_IMAGE_BASE}original${name}`,
        width: Number.isFinite(image.width) ? image.width : null,
        height: Number.isFinite(image.height) ? image.height : null,
        language: image.iso_639_1 || null,
        inUse: isCurrent,
        badge: isCurrent ? current.label || 'In use' : null,
        score: Number.isFinite(image.vote_average) ? image.vote_average : 0,
        position,
      })
    })

    items.sort(
      (a, b) =>
        Number(b.inUse) - Number(a.inUse) || languageRank(a.language) - languageRank(b.language) || b.score - a.score || a.position - b.position
    )

    const matched = items.some((item) => item.inUse)
    if (!matched && typeof current.url === 'string' && current.url) {
      items.unshift({
        key: `in-use-${kind.id}`,
        thumb: current.url,
        preview: current.url,
        full: current.url,
        width: null,
        height: null,
        language: null,
        inUse: true,
        badge: current.label || 'In use · custom',
      })
    }

    if (items.length > 0) {
      tabs.push({ id: kind.id, label: kind.label, items: items.map(({ score, position, ...item }) => item) })
    }
  }
  return tabs
}

/**
 * What a movie or show record currently uses, in the shape buildArtworkTabs
 * takes: the TMDB path its metadata names and the URL the library serves.
 *
 * @param {{ posterURL?: string|null, backdrop?: string|null, logo?: string|null, metadata?: { poster_path?: string|null, backdrop_path?: string|null, logo_path?: string|null }|null }|null|undefined} record
 * @returns {{ poster: { path: string|null, url: string|null }, backdrop: { path: string|null, url: string|null }, logo: { path: string|null, url: string|null } }}
 */
export function artworkInUse(record) {
  const meta = record?.metadata || {}
  return {
    poster: { path: meta.poster_path || null, url: record?.posterURL || null },
    backdrop: { path: meta.backdrop_path || null, url: record?.backdrop || null },
    logo: { path: meta.logo_path || null, url: record?.logo || null },
  }
}
