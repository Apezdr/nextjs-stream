/**
 * Admin media data-access layer (flat collections).
 *
 * Read-only helpers powering the modernized /admin/media interface. These run
 * on the server (RSC / route handlers) and read the modern flat collections
 * (FlatMovies, FlatTVShows, FlatSeasons, FlatEpisodes)  never the deprecated
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
import { buildQualityFilter, getQualityLabel } from '@src/utils/mediaQuality'

const DB_NAME = 'Media'

// Sort options exposed in the admin UI. "added" uses the ObjectId, which is
// monotonic with insertion time and always present (createdAt may be absent on
// some sync-upserted docs). Missing release dates sort last under desc.
// Sort keys map to the browser's visible columns. Each entry is the ASCENDING
// shape; resolveSort flips it for descending, and every entry carries a
// tiebreaker so paging stays stable across requests.
const MOVIE_SORTS = {
  title: { title: 1 },
  added: { _id: 1 },
  release: { 'metadata.release_date': 1, title: 1 },
  year: { 'metadata.release_date': 1, title: 1 },
  server: { videoSource: 1, title: 1 },
  quality: { _sortWidth: 1, title: 1 },
  size: { size: 1, title: 1 },
  duration: { duration: 1, title: 1 },
}
const TV_SORTS = {
  title: { title: 1 },
  added: { _id: 1 },
  release: { 'metadata.first_air_date': 1, title: 1 },
  year: { 'metadata.first_air_date': 1, title: 1 },
  server: { _sortServer: 1, title: 1 },
  quality: { _sortWidth: 1, title: 1 },
  seasons: { 'metadata.number_of_seasons': 1, title: 1 },
  episodes: { 'metadata.number_of_episodes': 1, title: 1 },
}

/** Column keys the UI may request, so a bad param cannot reach the driver. */
export const MOVIE_SORT_KEYS = Object.freeze(Object.keys(MOVIE_SORTS))
export const TV_SORT_KEYS = Object.freeze(Object.keys(TV_SORTS))

/**
 * @param {object} map one of the *_SORTS tables
 * @param {string} sort column key
 * @param {string} [direction] 'asc' | 'desc'
 */
/**
 * Some columns have no field to sort on. `dimensions` is a "WIDTHxHEIGHT"
 * string, and a TV show doc carries neither `dimensions` nor `videoSource` —
 * both are per-episode facts. Derive the key in the pipeline instead.
 */
const widthExpr = (fieldRef) => ({
  $convert: {
    input: { $arrayElemAt: [{ $split: [{ $ifNull: [fieldRef, '0x0'] }, 'x'] }, 0] },
    to: 'int',
    onError: 0,
    onNull: 0,
  },
})

/** Stages that materialize the sort keys a movie column needs, or none. */
function movieDeriveStages(sort) {
  if (sort !== 'quality') return []
  return [{ $addFields: { _sortWidth: widthExpr('$dimensions') } }]
}

/**
 * A show's quality and server come from the episodes it owns: widest episode,
 * and alphabetically-first server. `showId` is indexed on FlatEpisodes.
 */
function tvDeriveStages(sort) {
  if (sort !== 'quality' && sort !== 'server') return []
  return [
    {
      $lookup: {
        from: 'FlatEpisodes',
        localField: '_id',
        foreignField: 'showId',
        pipeline: [{ $project: { dimensions: 1, videoSource: 1 } }],
        as: '_episodes',
      },
    },
    {
      $addFields: {
        _sortWidth: {
          $max: { $map: { input: '$_episodes', as: 'e', in: widthExpr('$$e.dimensions') } },
        },
        _sortServer: { $min: '$_episodes.videoSource' },
      },
    },
  ]
}

function buildSortedQuery(col, { filter, projection, sortSpec, skip, limit, derive = [] }) {
  if (!derive.length) {
    return col.find(filter, { projection }).sort(sortSpec).skip(skip).limit(limit).toArray()
  }
  return col
    .aggregate([
      { $match: filter },
      ...derive,
      { $sort: sortSpec },
      { $skip: skip },
      { $limit: limit },
      { $project: projection },
    ])
    .toArray()
}

function resolveSort(map, sort, direction) {
  const base = map[sort] || map.title
  // Dates read newest-first by default; everything else reads A-Z / smallest.
  const defaultDesc = sort === 'added' || sort === 'release'
  const wantDesc = direction ? direction === 'desc' : defaultDesc
  if (!wantDesc) return base
  return Object.fromEntries(Object.entries(base).map(([field, dir]) => [field, dir === 1 ? -1 : 1]))
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
 * (e.g. { posterURL: true, metadata: { overview: true } }  2).
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

/** Largest page the browser is allowed to request when not asking for everything. */
export const ADMIN_PAGE_SIZES = Object.freeze([25, 50, 100, 250, 500])

/** Clamp + normalize pagination inputs shared by both list helpers. */
function normalizePaging(page, pageSize) {
  const safePage = Math.max(1, parseInt(page, 10) || 1)
  // 'all' collapses to a single page. The caller still passes a limit to the
  // driver so a runaway collection cannot stream unbounded documents.
  if (String(pageSize).toLowerCase() === 'all') {
    return { safePage: 1, safeSize: 'all', skip: 0, limit: 5000 }
  }
  const requested = parseInt(pageSize, 10) || 25
  const safeSize = Math.min(ADMIN_PAGE_SIZES[ADMIN_PAGE_SIZES.length - 1], Math.max(1, requested))
  return { safePage, safeSize, skip: (safePage - 1) * safeSize, limit: safeSize }
}

/** Build a title/originalTitle search filter (empty object when no search). */
function buildSearchFilter(search) {
  if (!search || !String(search).trim()) return {}
  const rx = new RegExp(escapeRegex(String(search).trim()), 'i')
  return { $or: [{ title: rx }, { originalTitle: rx }] }
}

function combineFilters(...filters) {
  const clauses = filters.filter(filter => filter && Object.keys(filter).length > 0)
  if (clauses.length === 0) return {}
  if (clauses.length === 1) return clauses[0]
  return { $and: clauses }
}

function buildYearFilter(year, field) {
  return /^\d{4}$/.test(String(year || '')) ? { [field]: new RegExp(`^${year}`) } : {}
}

function buildVideoFilter(video) {
  if (video === 'available') return { videoURL: { $type: 'string', $ne: '' } }
  if (video === 'missing') {
    return { $or: [{ videoURL: { $exists: false } }, { videoURL: null }, { videoURL: '' }] }
  }
  return {}
}

function buildHdrFilter(hdr) {
  // Older sync records may store generic HDR as true; named formats are strings.
  if (hdr === 'hdr') return { hdr: { $exists: true, $nin: [null, false, ''] } }
  if (hdr === 'sdr') return { $or: [{ hdr: { $exists: false } }, { hdr: null }, { hdr: false }, { hdr: '' }] }
  return {}
}

/**
 * Paginated + searchable movie list for the admin table.
 * @returns {Promise<{items: Array, total: number, page: number, pageSize: number}>}
 */
export async function listAdminMovies({
  page = 1,
  pageSize = 25,
  search = '',
  sort = 'title',
  dir = '',
  serverId = '',
  quality = '',
  year = '',
  video = '',
  hdr = '',
} = {}) {
  const client = await clientPromise
  const col = client.db(DB_NAME).collection('FlatMovies')
  const filter = combineFilters(
    buildSearchFilter(search),
    serverId ? { videoSource: serverId } : {},
    buildQualityFilter(quality),
    buildYearFilter(year, 'metadata.release_date'),
    buildVideoFilter(video),
    buildHdrFilter(hdr)
  )
  const { safePage, safeSize, skip, limit } = normalizePaging(page, pageSize)

  const projection = {
    title: 1,
    originalTitle: 1,
    posterURL: 1,
    videoURL: 1,
    videoSource: 1,
    hdr: 1,
    duration: 1,
    dimensions: 1,
    size: 1,
    manualEntry: 1,
    lockedFields: 1,
    updatedAt: 1,
    // Web-visibility signals for the admin "Hidden" badge (admin sees all;
    // never filter here).
    primaryContainer: 1,
    jitUrl: 1,
    'metadata.poster_path': 1,
    'metadata.release_date': 1,
  }

  const [docs, total] = await Promise.all([
    buildSortedQuery(col, { filter, projection, sortSpec: resolveSort(MOVIE_SORTS, sort, dir), skip, limit, derive: movieDeriveStages(sort) }),
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
    quality: getQualityLabel(m.dimensions),
    qualities: [getQualityLabel(m.dimensions)],
    serverIds: typeof m.videoSource === 'string' ? [m.videoSource] : [],
    // Raw signals so the UI can evaluate isWebVisible(item)
    videoURL: m.videoURL ?? null,
    primaryContainer: m.primaryContainer ?? null,
    jitUrl: m.jitUrl ?? null,
    hdr: m.hdr ?? null,
    manualEntry: Boolean(m.manualEntry),
    lockedCount: countLocks(m.lockedFields),
    // FlatMovies stores size in bytes. FlatEpisodes stores KiB for nearly every
    // row, so do NOT reuse this shape for TV without normalizing first
    // (see the heuristics in src/utils/mediaActivity.js).
    sizeBytes: typeof m.size === 'number' && m.size > 0 ? m.size : null,
  }))

  return { items, total, page: safePage, pageSize: safeSize }
}

/**
 * Paginated + searchable TV show list with season/episode counts.
 * Counts are computed with two grouped aggregations over the showIds on the
 * current page (avoids materializing every episode via $lookup).
 * @returns {Promise<{items: Array, total: number, page: number, pageSize: number}>}
 */
export async function listAdminTVShows({
  page = 1,
  pageSize = 25,
  search = '',
  sort = 'title',
  dir = '',
  serverId = '',
  quality = '',
  year = '',
  video = '',
  hdr = '',
} = {}) {
  const client = await clientPromise
  const db = client.db(DB_NAME)
  const col = db.collection('FlatTVShows')
  const episodeCollection = db.collection('FlatEpisodes')
  // TV shows may span servers at episode granularity. Resolve membership from
  // episode ownership rather than assigning one arbitrary show-level server.
  const episodeMembershipFilter = combineFilters(
    serverId ? { videoSource: serverId } : {},
    buildQualityFilter(quality),
    video === 'available' ? buildVideoFilter(video) : {},
    buildHdrFilter(hdr),
    (serverId || quality || video === 'available' || hdr) ? { showId: { $ne: null } } : {}
  )
  const matchingShowIds = Object.keys(episodeMembershipFilter).length > 0
    ? await episodeCollection.distinct('showId', episodeMembershipFilter)
    : null
  const showsWithVideo = video === 'missing'
    ? await episodeCollection.distinct('showId', combineFilters(
        buildVideoFilter('available'),
        { showId: { $ne: null } }
      ))
    : null
  const filter = combineFilters(
    buildSearchFilter(search),
    matchingShowIds ? { _id: { $in: matchingShowIds } } : {},
    showsWithVideo ? { _id: { $nin: showsWithVideo } } : {},
    buildYearFilter(year, 'metadata.first_air_date')
  )
  const { safePage, safeSize, skip, limit } = normalizePaging(page, pageSize)

  const projection = {
    title: 1,
    originalTitle: 1,
    posterURL: 1,
    manualEntry: 1,
    lockedFields: 1,
    updatedAt: 1,
    // Web-visibility signal for the admin "Hidden" badge (admin sees all)
    visibleEpisodeCount: 1,
    'metadata.poster_path': 1,
    'metadata.first_air_date': 1,
    'metadata.last_air_date': 1,
  }

  const [docs, total] = await Promise.all([
    buildSortedQuery(col, { filter, projection, sortSpec: resolveSort(TV_SORTS, sort, dir), skip, limit, derive: tvDeriveStages(sort) }),
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
              {
                $group: {
                  _id: '$showId',
                  count: { $sum: 1 },
                  serverIds: { $addToSet: '$videoSource' },
                  dimensions: { $addToSet: '$dimensions' },
                  hdrValues: { $addToSet: '$hdr' },
                  // Count playable episodes instead of treating every episode
                  // document as video availability.
                  videoCount: {
                    $sum: {
                      $cond: [
                        { $and: [
                          { $eq: [{ $type: '$videoURL' }, 'string'] },
                          { $ne: ['$videoURL', ''] },
                        ] },
                        1,
                        0,
                      ],
                    },
                  },
                },
              },
            ])
            .toArray(),
        ])

  const seasonCountMap = new Map(seasonCounts.map((s) => [s._id.toString(), s.count]))
  const episodeCountMap = new Map(episodeCounts.map((e) => [e._id.toString(), e.count]))
  const episodeVideoCountMap = new Map(episodeCounts.map((e) => [e._id.toString(), e.videoCount || 0]))
  const episodeServerMap = new Map(episodeCounts.map((episode) => [
    episode._id.toString(),
    [...new Set((episode.serverIds || []).filter(server => typeof server === 'string'))].sort(),
  ]))
  const episodeQualityMap = new Map(episodeCounts.map((episode) => [
    episode._id.toString(),
    [...new Set((episode.dimensions || []).map(getQualityLabel))].sort(),
  ]))
  const episodeHdrMap = new Map(episodeCounts.map((episode) => [
    episode._id.toString(),
    [...new Set((episode.hdrValues || []).flatMap(value => {
      if (value === true) return ['HDR']
      return typeof value === 'string' && value.trim() ? [value.trim()] : []
    }))].sort(),
  ]))

  const items = docs.map((s) => {
    const idStr = s._id.toString()
    const startYear = getYear(s.metadata?.first_air_date)
    const endYear = getYear(s.metadata?.last_air_date)
    let years = startYear ? String(startYear) : null
    if (startYear && endYear && startYear !== endYear) years = `${startYear}\u2013${endYear}`
    return {
      id: idStr,
      title: s.title,
      originalTitle: s.originalTitle ?? null,
      posterURL:
        s.posterURL ||
        (s.metadata?.poster_path ? getFullImageUrl(s.metadata.poster_path, 'w185') : null),
      years,
      // Grouping buckets on a single year; the range would give every show its own group.
      year: startYear ?? null,
      seasonCount: seasonCountMap.get(idStr) ?? 0,
      episodeCount: episodeCountMap.get(idStr) ?? 0,
      videoCount: episodeVideoCountMap.get(idStr) ?? 0,
      serverIds: episodeServerMap.get(idStr) ?? [],
      qualities: episodeQualityMap.get(idStr) ?? [],
      quality: (episodeQualityMap.get(idStr) || []).length === 1
        ? episodeQualityMap.get(idStr)[0]
        : (episodeQualityMap.get(idStr) || []).length > 1 ? 'Mixed' : 'Unknown',
      hdrValues: episodeHdrMap.get(idStr) ?? [],
      hasVideo: (episodeVideoCountMap.get(idStr) ?? 0) > 0,
      // Raw signal so the UI can evaluate isShowWebVisible(item)
      visibleEpisodeCount: s.visibleEpisodeCount ?? null,
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
