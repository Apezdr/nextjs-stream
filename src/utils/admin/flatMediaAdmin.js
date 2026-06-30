/**
 * Admin media data-access layer (flat collections).
 *
 * Read-only helpers powering the modernized /admin/media interface. These run
 * on the server (RSC / route handlers) and read the modern flat collections
 * (FlatMovies, FlatTVShows, FlatSeasons, FlatEpisodes) — never the deprecated
 * nested Media.Movies / Media.TV collections.
 *
 * Single-record editor loads reuse getFlatRequestedMedia (full-document reads).
 * The paginated/searchable list queries are dedicated here because
 * getFlatPosters has a pagination bug (skip = page * limit) and lacks
 * search/total support.
 */

import clientPromise from '@src/lib/mongodb'
import { ObjectId } from 'mongodb'
import { getFlatRequestedMedia } from '@src/utils/flatDatabaseUtils'
import { getFullImageUrl } from '@src/utils'

const DB_NAME = 'Media'

// Sort options exposed in the admin UI. "added" uses the ObjectId, which is
// monotonic with insertion time and always present (createdAt may be absent on
// some sync-upserted docs). Missing release dates sort last under desc.
const MOVIE_SORTS = {
  title: { title: 1 },
  added: { _id: -1 },
  release: { 'metadata.release_date': -1, title: 1 },
}
const TV_SORTS = {
  title: { title: 1 },
  added: { _id: -1 },
  release: { 'metadata.first_air_date': -1, title: 1 },
}

function resolveSort(map, sort) {
  return map[sort] || map.title
}

/** Escape user input before embedding it in a RegExp. */
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Extract a 4-digit year from a Date or date-string; null when unparseable. */
function getYear(dateValue) {
  if (!dateValue) return null
  const d = dateValue instanceof Date ? dateValue : new Date(dateValue)
  return Number.isNaN(d.getTime()) ? null : d.getFullYear()
}

/**
 * Count locked fields in the nested lockedFields structure
 * (e.g. { posterURL: true, metadata: { overview: true } } → 2).
 */
function countLocks(lockedFields) {
  if (!lockedFields || typeof lockedFields !== 'object') return 0
  let count = 0
  for (const value of Object.values(lockedFields)) {
    if (value === true) count += 1
    else if (value && typeof value === 'object') count += countLocks(value)
  }
  return count
}

/** Clamp + normalize pagination inputs shared by both list helpers. */
function normalizePaging(page, pageSize) {
  const safePage = Math.max(1, parseInt(page, 10) || 1)
  const safeSize = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 25))
  return { safePage, safeSize, skip: (safePage - 1) * safeSize }
}

/** Build a title/originalTitle search filter (empty object when no search). */
function buildSearchFilter(search) {
  if (!search || !String(search).trim()) return {}
  const rx = new RegExp(escapeRegex(String(search).trim()), 'i')
  return { $or: [{ title: rx }, { originalTitle: rx }] }
}

/**
 * Paginated + searchable movie list for the admin table.
 * @returns {Promise<{items: Array, total: number, page: number, pageSize: number}>}
 */
export async function listAdminMovies({ page = 1, pageSize = 25, search = '', sort = 'title' } = {}) {
  const client = await clientPromise
  const col = client.db(DB_NAME).collection('FlatMovies')
  const filter = buildSearchFilter(search)
  const { safePage, safeSize, skip } = normalizePaging(page, pageSize)

  const projection = {
    title: 1,
    originalTitle: 1,
    posterURL: 1,
    videoURL: 1,
    hdr: 1,
    duration: 1,
    manualEntry: 1,
    lockedFields: 1,
    updatedAt: 1,
    'metadata.poster_path': 1,
    'metadata.release_date': 1,
  }

  const [docs, total] = await Promise.all([
    col.find(filter, { projection }).sort(resolveSort(MOVIE_SORTS, sort)).skip(skip).limit(safeSize).toArray(),
    col.countDocuments(filter),
  ])

  const items = docs.map((m) => ({
    id: m._id.toString(),
    title: m.title,
    originalTitle: m.originalTitle ?? null,
    posterURL:
      m.posterURL ||
      (m.metadata?.poster_path ? getFullImageUrl(m.metadata.poster_path, 'w185') : null),
    year: getYear(m.metadata?.release_date),
    hasVideo: Boolean(m.videoURL),
    hdr: m.hdr ?? null,
    manualEntry: Boolean(m.manualEntry),
    lockedCount: countLocks(m.lockedFields),
  }))

  return { items, total, page: safePage, pageSize: safeSize }
}

/**
 * Paginated + searchable TV show list with season/episode counts.
 * Counts are computed with two grouped aggregations over the showIds on the
 * current page (avoids materializing every episode via $lookup).
 * @returns {Promise<{items: Array, total: number, page: number, pageSize: number}>}
 */
export async function listAdminTVShows({ page = 1, pageSize = 25, search = '', sort = 'title' } = {}) {
  const client = await clientPromise
  const db = client.db(DB_NAME)
  const col = db.collection('FlatTVShows')
  const filter = buildSearchFilter(search)
  const { safePage, safeSize, skip } = normalizePaging(page, pageSize)

  const projection = {
    title: 1,
    originalTitle: 1,
    posterURL: 1,
    manualEntry: 1,
    lockedFields: 1,
    updatedAt: 1,
    'metadata.poster_path': 1,
    'metadata.first_air_date': 1,
    'metadata.last_air_date': 1,
  }

  const [docs, total] = await Promise.all([
    col.find(filter, { projection }).sort(resolveSort(TV_SORTS, sort)).skip(skip).limit(safeSize).toArray(),
    col.countDocuments(filter),
  ])

  const showIds = docs.map((s) => s._id)
  const [seasonCounts, episodeCounts] =
    showIds.length === 0
      ? [[], []]
      : await Promise.all([
          db
            .collection('FlatSeasons')
            .aggregate([
              { $match: { showId: { $in: showIds } } },
              { $group: { _id: '$showId', count: { $sum: 1 } } },
            ])
            .toArray(),
          db
            .collection('FlatEpisodes')
            .aggregate([
              { $match: { showId: { $in: showIds } } },
              { $group: { _id: '$showId', count: { $sum: 1 } } },
            ])
            .toArray(),
        ])

  const seasonCountMap = new Map(seasonCounts.map((s) => [s._id.toString(), s.count]))
  const episodeCountMap = new Map(episodeCounts.map((e) => [e._id.toString(), e.count]))

  const items = docs.map((s) => {
    const idStr = s._id.toString()
    const startYear = getYear(s.metadata?.first_air_date)
    const endYear = getYear(s.metadata?.last_air_date)
    let years = startYear ? String(startYear) : null
    if (startYear && endYear && startYear !== endYear) years = `${startYear}–${endYear}`
    return {
      id: idStr,
      title: s.title,
      originalTitle: s.originalTitle ?? null,
      posterURL:
        s.posterURL ||
        (s.metadata?.poster_path ? getFullImageUrl(s.metadata.poster_path, 'w185') : null),
      years,
      seasonCount: seasonCountMap.get(idStr) ?? 0,
      episodeCount: episodeCountMap.get(idStr) ?? 0,
      manualEntry: Boolean(s.manualEntry),
      lockedCount: countLocks(s.lockedFields),
    }
  })

  return { items, total, page: safePage, pageSize: safeSize }
}

/**
 * Full movie document for the editor. Reuses getFlatRequestedMedia, which
 * returns the raw doc (including lockedFields, *Source, captionURLs, etc.)
 * with _id stringified.
 * @returns {Promise<Object|null>}
 */
export async function getAdminMovie(id) {
  if (!id) throw new Error('getAdminMovie: id is required')
  return getFlatRequestedMedia({ type: 'movie', id })
}

/**
 * Full TV show document for the editor: show + seasons (via
 * getFlatRequestedMedia) with each season's episodes attached from
 * FlatEpisodes. All ObjectIds are stringified for client serialization.
 * @returns {Promise<Object|null>}
 */
export async function getAdminTVShow(id) {
  if (!id) throw new Error('getAdminTVShow: id is required')

  const show = await getFlatRequestedMedia({ type: 'tv', id })
  if (!show) return null

  const client = await clientPromise
  const showObjectId = new ObjectId(show._id)
  const episodeDocs = await client
    .db(DB_NAME)
    .collection('FlatEpisodes')
    .find({ showId: showObjectId })
    .sort({ seasonNumber: 1, episodeNumber: 1 })
    .toArray()

  const episodesBySeason = new Map()
  for (const ep of episodeDocs) {
    const episode = {
      ...ep,
      _id: ep._id.toString(),
      showId: ep.showId ? ep.showId.toString() : null,
      seasonId: ep.seasonId ? ep.seasonId.toString() : null,
    }
    const list = episodesBySeason.get(ep.seasonNumber) || []
    list.push(episode)
    episodesBySeason.set(ep.seasonNumber, list)
  }

  show.seasons = (show.seasons || []).map((season) => ({
    ...season,
    episodes: episodesBySeason.get(season.seasonNumber) || [],
  }))

  return show
}
