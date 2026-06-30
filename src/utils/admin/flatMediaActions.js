'use server'

/**
 * Admin media Server Actions (flat collections).
 *
 * Create / update / delete for FlatMovies, FlatTVShows, FlatSeasons,
 * FlatEpisodes, powering the modernized /admin/media editors.
 *
 * Design rules (see plan + CLAUDE.md):
 *  - Never stamp `syncRunId` — these run outside a sync orchestration. Manual
 *    survival is guaranteed by `manualEntry: true` (set only on standalone
 *    create) + the postSyncCleanup exclusion, NOT by the run-id marker.
 *  - Any admin-edited asset/metadata field records its provenance as
 *    `<field>Source: 'manual'` so the priority system and future syncs can see
 *    it was set by a human.
 *  - `lockedFields` is persisted in the nested shape `filterLockedFields`
 *    expects ({ posterURL: true, metadata: { overview: true } }).
 *  - Validation / duplicate / not-found problems are returned as
 *    { status: 'error', message } so the editor can surface them via
 *    useActionState — the write is aborted, never defaulted.
 *  - Schema invariants honored: shows/movies keyed by unique title +
 *    originalTitle; seasons keyed by (showId, seasonNumber) with denormalized
 *    showTitle (= show display title); episodes keyed by
 *    (showId, seasonId, episodeNumber) with showTitle/seasonNumber denormalized.
 *    A show rename cascades showTitle to its seasons + episodes.
 */

import { ObjectId } from 'mongodb'
import { revalidatePath } from 'next/cache'
import clientPromise from '@src/lib/mongodb'
import { generateNormalizedVideoId } from '@src/utils/flatDatabaseUtils'
import {
  invalidateMovieDetailsCache,
  invalidateTVShowDetailsCache,
  invalidateSeasonDetailsCache,
  invalidateEpisodeDetailsCache,
} from '@src/utils/cache/invalidation'

const DB_NAME = 'Media'

// ─── Result helpers ──────────────────────────────────────────────────────────
const ok = (extra = {}) => ({ status: 'success', message: 'Saved.', ...extra })
const fail = (message) => ({ status: 'error', message })

// ─── Small utilities ─────────────────────────────────────────────────────────
function toObjectId(id) {
  if (id && ObjectId.isValid(id)) return new ObjectId(id)
  return null
}

function trimOrNull(v) {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s.length ? s : null
}

function parseIntStrict(v) {
  const n = parseInt(v, 10)
  return Number.isNaN(n) ? null : n
}

/** True for the friendly duplicate-key path (unique index violation). */
function isDuplicateKeyError(error) {
  return error && (error.code === 11000 || error.codeName === 'DuplicateKey')
}

function revalidateMedia() {
  revalidatePath('/admin/media')
  revalidatePath('/admin/media/movies')
  revalidatePath('/admin/media/tv')
}

/**
 * Build $set / $unset from a whitelist of scalar fields.
 * - non-empty value  → $set field (+ `<field>Source: 'manual'` if mapped)
 * - empty string/null → $unset field (update only; skipped on create)
 * @returns {{ set: Object, unset: Object }}
 */
function applyScalarFields(payload, fields, sourceMap, { isCreate }) {
  const set = {}
  const unset = {}
  for (const field of fields) {
    if (!(field in payload)) continue
    const raw = payload[field]
    let value = raw

    if (field === 'duration') value = raw === '' || raw == null ? null : Number(raw)
    else if (typeof raw === 'string') value = raw.trim()

    const isEmpty = value === '' || value === null || value === undefined || Number.isNaN(value)
    if (isEmpty) {
      if (!isCreate) unset[field] = ''
      continue
    }

    set[field] = value
    if (sourceMap[field]) set[sourceMap[field]] = 'manual'
    if (field === 'videoURL') set.normalizedVideoId = generateNormalizedVideoId(value)
  }
  return { set, unset }
}

/** Merge metadata partial as dot-paths so existing metadata keys survive. */
function applyMetadata(payload, set) {
  if (!payload.metadata || typeof payload.metadata !== 'object') return
  let touched = false
  for (const [key, value] of Object.entries(payload.metadata)) {
    if (value === undefined) continue
    set[`metadata.${key}`] = value
    touched = true
  }
  if (touched) set.metadataSource = 'manual'
}

/** Decide captionURLs $set vs $unset from the provided object. */
function applyCaptionURLs(payload, set, unset) {
  if (!('captionURLs' in payload)) return
  const caps = payload.captionURLs
  if (caps && typeof caps === 'object' && Object.keys(caps).length > 0) set.captionURLs = caps
  else unset.captionURLs = ''
}

/** Decide lockedFields $set vs $unset from the provided nested object. */
function applyLockedFields(payload, set, unset) {
  if (!('lockedFields' in payload)) return
  const locks = payload.lockedFields
  if (locks && typeof locks === 'object' && Object.keys(locks).length > 0) set.lockedFields = locks
  else unset.lockedFields = ''
}

// ─── Field whitelists + source maps ──────────────────────────────────────────
const MOVIE_FIELDS = [
  'title', 'originalTitle', 'videoURL', 'posterURL', 'posterBlurhash',
  'backdrop', 'backdropBlurhash', 'logo', 'chapterURL', 'hdr', 'duration',
]
const MOVIE_SOURCE_MAP = {
  posterURL: 'posterSource',
  posterBlurhash: 'posterBlurhashSource',
  backdrop: 'backdropSource',
  backdropBlurhash: 'backdropBlurhashSource',
  logo: 'logoSource',
  videoURL: 'videoSource',
}

const SHOW_FIELDS = [
  'title', 'originalTitle', 'posterURL', 'posterBlurhash',
  'backdrop', 'backdropBlurhash', 'logo',
]
const SHOW_SOURCE_MAP = {
  posterURL: 'posterSource',
  posterBlurhash: 'posterBlurhashSource',
  backdrop: 'backdropSource',
  backdropBlurhash: 'backdropBlurhashSource',
  logo: 'logoSource',
}

const SEASON_FIELDS = ['posterURL', 'posterBlurhash']
const SEASON_SOURCE_MAP = {
  posterURL: 'posterSource',
  posterBlurhash: 'posterBlurhashSource',
}

const EPISODE_FIELDS = [
  'title', 'videoURL', 'thumbnail', 'thumbnailBlurhash', 'chapterURL', 'hdr', 'duration',
]
const EPISODE_SOURCE_MAP = {
  videoURL: 'videoSource',
  thumbnail: 'thumbnailSource',
  thumbnailBlurhash: 'thumbnailBlurhashSource',
}

// ─── Movies ──────────────────────────────────────────────────────────────────

export async function createMovieAction(_prevState, payload = {}) {
  const title = trimOrNull(payload.title)
  const videoURL = trimOrNull(payload.videoURL)
  if (!title) return fail('Title is required.')
  if (!videoURL) return fail('Video URL is required.')

  const originalTitle = trimOrNull(payload.originalTitle) || title
  const client = await clientPromise
  const col = client.db(DB_NAME).collection('FlatMovies')

  const clash = await col.findOne(
    { $or: [{ title }, { originalTitle }] },
    { projection: { _id: 1 } }
  )
  if (clash) return fail(`A movie with title "${title}" or originalTitle "${originalTitle}" already exists.`)

  const now = new Date()
  const { set } = applyScalarFields({ ...payload, title, originalTitle, videoURL }, MOVIE_FIELDS, MOVIE_SOURCE_MAP, { isCreate: true })
  applyMetadata(payload, set)
  applyCaptionURLs(payload, set, {})
  applyLockedFields(payload, set, {})

  const doc = {
    _id: new ObjectId(),
    type: 'movie',
    manualEntry: true,
    ...set,
    title,
    originalTitle,
    videoURL,
    normalizedVideoId: generateNormalizedVideoId(videoURL),
    mediaLastModified: now,
    createdAt: now,
    updatedAt: now,
  }

  try {
    await col.insertOne(doc)
  } catch (error) {
    if (isDuplicateKeyError(error)) return fail('A movie with that title already exists.')
    throw error
  }

  revalidateMedia()
  // Bust public detail page + landing horizontal lists (media-library/movies/all).
  await invalidateMovieDetailsCache(title)
  return ok({ id: doc._id.toString() })
}

export async function saveMovieAction(_prevState, payload = {}) {
  const _id = toObjectId(payload.id)
  if (!_id) return fail('A valid movie id is required.')

  const client = await clientPromise
  const col = client.db(DB_NAME).collection('FlatMovies')
  const existing = await col.findOne({ _id })
  if (!existing) return fail('Movie not found.')

  const { set, unset } = applyScalarFields(payload, MOVIE_FIELDS, MOVIE_SOURCE_MAP, { isCreate: false })
  applyMetadata(payload, set)
  applyCaptionURLs(payload, set, unset)
  applyLockedFields(payload, set, unset)

  if ('videoURL' in set && set.videoURL !== existing.videoURL) set.mediaLastModified = new Date()
  set.updatedAt = new Date()

  const update = {}
  if (Object.keys(set).length) update.$set = set
  if (Object.keys(unset).length) update.$unset = unset
  if (!update.$set && !update.$unset) return ok({ id: payload.id, message: 'No changes.' })

  try {
    await col.updateOne({ _id }, update)
  } catch (error) {
    if (isDuplicateKeyError(error)) return fail('Another movie already uses that title / originalTitle.')
    throw error
  }

  revalidateMedia()
  revalidatePath(`/admin/media/movies/${payload.id}`)
  // Bust public detail page + landing horizontal lists. On a rename, bust both
  // the new and old display titles (the old title's detail tag would otherwise linger).
  const movieTitle = set.title ?? existing.title
  if (movieTitle) await invalidateMovieDetailsCache(movieTitle)
  if (set.title && set.title !== existing.title && existing.title) {
    await invalidateMovieDetailsCache(existing.title)
  }
  return ok({ id: payload.id })
}

export async function deleteMovieAction(_prevState, payload = {}) {
  const _id = toObjectId(payload.id)
  if (!_id) return fail('A valid movie id is required.')

  const client = await clientPromise
  const col = client.db(DB_NAME).collection('FlatMovies')
  const existing = await col.findOne({ _id }, { projection: { title: 1 } })
  const result = await col.deleteOne({ _id })
  if (result.deletedCount === 0) return fail('Movie not found.')

  revalidateMedia()
  if (existing?.title) await invalidateMovieDetailsCache(existing.title)
  return ok({ deleted: true })
}

// ─── TV Shows ────────────────────────────────────────────────────────────────

export async function createTVShowAction(_prevState, payload = {}) {
  const title = trimOrNull(payload.title)
  if (!title) return fail('Title is required.')

  const originalTitle = trimOrNull(payload.originalTitle) || title
  const client = await clientPromise
  const col = client.db(DB_NAME).collection('FlatTVShows')

  const clash = await col.findOne(
    { $or: [{ title }, { originalTitle }] },
    { projection: { _id: 1 } }
  )
  if (clash) return fail(`A show with title "${title}" or originalTitle "${originalTitle}" already exists.`)

  const now = new Date()
  const { set } = applyScalarFields({ ...payload, title, originalTitle }, SHOW_FIELDS, SHOW_SOURCE_MAP, { isCreate: true })
  applyMetadata(payload, set)
  applyLockedFields(payload, set, {})

  const doc = {
    _id: new ObjectId(),
    type: 'tvShow',
    manualEntry: true,
    ...set,
    title,
    originalTitle,
    createdAt: now,
    updatedAt: now,
  }

  try {
    await col.insertOne(doc)
  } catch (error) {
    if (isDuplicateKeyError(error)) return fail('A show with that title already exists.')
    throw error
  }

  revalidateMedia()
  await invalidateTVShowDetailsCache(title)
  return ok({ id: doc._id.toString() })
}

export async function saveTVShowAction(_prevState, payload = {}) {
  const _id = toObjectId(payload.id)
  if (!_id) return fail('A valid show id is required.')

  const client = await clientPromise
  const db = client.db(DB_NAME)
  const col = db.collection('FlatTVShows')
  const existing = await col.findOne({ _id })
  if (!existing) return fail('TV show not found.')

  const { set, unset } = applyScalarFields(payload, SHOW_FIELDS, SHOW_SOURCE_MAP, { isCreate: false })
  applyMetadata(payload, set)
  applyLockedFields(payload, set, unset)
  set.updatedAt = new Date()

  const update = {}
  if (Object.keys(set).length) update.$set = set
  if (Object.keys(unset).length) update.$unset = unset

  try {
    await col.updateOne({ _id }, update)
  } catch (error) {
    if (isDuplicateKeyError(error)) return fail('Another show already uses that title / originalTitle.')
    throw error
  }

  // Cascade a display-title change to denormalized showTitle on seasons + episodes
  // so their unique indexes ({showTitle, seasonNumber} / {..., episodeNumber}) stay
  // consistent and natural-key lookups keep resolving.
  if ('title' in set && set.title !== existing.title) {
    await Promise.all([
      db.collection('FlatSeasons').updateMany({ showId: _id }, { $set: { showTitle: set.title } }),
      db.collection('FlatEpisodes').updateMany({ showId: _id }, { $set: { showTitle: set.title } }),
    ])
  }

  revalidateMedia()
  revalidatePath(`/admin/media/tv/${payload.id}`)
  // Bust public detail page + landing lists (media-library/tv/all). Cover the old
  // title too on a rename so its stale detail/list entries clear.
  const showTitle = set.title ?? existing.title
  if (showTitle) await invalidateTVShowDetailsCache(showTitle)
  if (set.title && set.title !== existing.title && existing.title) {
    await invalidateTVShowDetailsCache(existing.title)
  }
  return ok({ id: payload.id })
}

export async function deleteTVShowAction(_prevState, payload = {}) {
  const _id = toObjectId(payload.id)
  if (!_id) return fail('A valid show id is required.')

  const client = await clientPromise
  const db = client.db(DB_NAME)
  const existing = await db.collection('FlatTVShows').findOne({ _id }, { projection: { title: 1 } })
  if (!existing) return fail('TV show not found.')

  // Cascade delete: episodes → seasons → show
  await db.collection('FlatEpisodes').deleteMany({ showId: _id })
  await db.collection('FlatSeasons').deleteMany({ showId: _id })
  await db.collection('FlatTVShows').deleteOne({ _id })

  revalidateMedia()
  if (existing.title) await invalidateTVShowDetailsCache(existing.title)
  return ok({ deleted: true })
}

// ─── Seasons ─────────────────────────────────────────────────────────────────

export async function saveSeasonAction(_prevState, payload = {}) {
  const showId = toObjectId(payload.showId)
  const seasonNumber = parseIntStrict(payload.seasonNumber)
  if (!showId) return fail('A valid showId is required.')
  if (seasonNumber === null || seasonNumber < 0) return fail('A valid season number is required.')

  const client = await clientPromise
  const db = client.db(DB_NAME)
  const show = await db.collection('FlatTVShows').findOne({ _id: showId }, { projection: { title: 1 } })
  if (!show) return fail('Parent TV show not found.')

  const seasonsCol = db.collection('FlatSeasons')
  const seasonObjId = toObjectId(payload.seasonId)
  const existing = seasonObjId
    ? await seasonsCol.findOne({ _id: seasonObjId })
    : await seasonsCol.findOne({ showId, seasonNumber })

  const { set, unset } = applyScalarFields(payload, SEASON_FIELDS, SEASON_SOURCE_MAP, { isCreate: !existing })
  applyMetadata(payload, set)
  applyLockedFields(payload, set, unset)
  set.showTitle = show.title
  set.showId = showId
  set.seasonNumber = seasonNumber
  set.updatedAt = new Date()

  if (existing) {
    const update = { $set: set }
    if (Object.keys(unset).length) update.$unset = unset
    await seasonsCol.updateOne({ _id: existing._id }, update)
    revalidateMedia()
    revalidatePath(`/admin/media/tv/${showId.toString()}`)
    // Bust public season + parent-show detail pages and landing lists.
    await invalidateSeasonDetailsCache(show.title, seasonNumber)
    return ok({ id: existing._id.toString() })
  }

  const doc = {
    _id: new ObjectId(),
    type: 'season',
    manualEntry: true,
    ...set,
    createdAt: new Date(),
  }
  try {
    await seasonsCol.insertOne(doc)
  } catch (error) {
    if (isDuplicateKeyError(error)) return fail(`Season ${seasonNumber} already exists for this show.`)
    throw error
  }

  revalidateMedia()
  revalidatePath(`/admin/media/tv/${showId.toString()}`)
  await invalidateSeasonDetailsCache(show.title, seasonNumber)
  return ok({ id: doc._id.toString() })
}

export async function deleteSeasonAction(_prevState, payload = {}) {
  const showId = toObjectId(payload.showId)
  const seasonNumber = parseIntStrict(payload.seasonNumber)
  if (!showId) return fail('A valid showId is required.')
  if (seasonNumber === null) return fail('A valid season number is required.')

  const client = await clientPromise
  const db = client.db(DB_NAME)
  const show = await db.collection('FlatTVShows').findOne({ _id: showId }, { projection: { title: 1 } })
  // Remove the season and all of its episodes
  await db.collection('FlatEpisodes').deleteMany({ showId, seasonNumber })
  const result = await db.collection('FlatSeasons').deleteOne({ showId, seasonNumber })
  if (result.deletedCount === 0) return fail('Season not found.')

  revalidateMedia()
  revalidatePath(`/admin/media/tv/${showId.toString()}`)
  if (show?.title) await invalidateSeasonDetailsCache(show.title, seasonNumber)
  return ok({ deleted: true })
}

// ─── Episodes ────────────────────────────────────────────────────────────────

export async function saveEpisodeAction(_prevState, payload = {}) {
  const showId = toObjectId(payload.showId)
  const seasonNumber = parseIntStrict(payload.seasonNumber)
  const episodeNumber = parseIntStrict(payload.episodeNumber)
  if (!showId) return fail('A valid showId is required.')
  if (seasonNumber === null || seasonNumber < 0) return fail('A valid season number is required.')
  if (episodeNumber === null || episodeNumber < 0) return fail('A valid episode number is required.')

  const client = await clientPromise
  const db = client.db(DB_NAME)
  const show = await db.collection('FlatTVShows').findOne({ _id: showId }, { projection: { title: 1 } })
  if (!show) return fail('Parent TV show not found.')

  const season = await db
    .collection('FlatSeasons')
    .findOne({ showId, seasonNumber }, { projection: { _id: 1 } })
  if (!season) return fail(`Season ${seasonNumber} must exist before adding episodes.`)

  const episodesCol = db.collection('FlatEpisodes')
  const episodeObjId = toObjectId(payload.episodeId)
  const existing = episodeObjId
    ? await episodesCol.findOne({ _id: episodeObjId })
    : await episodesCol.findOne({ showId, seasonId: season._id, episodeNumber })

  const { set, unset } = applyScalarFields(payload, EPISODE_FIELDS, EPISODE_SOURCE_MAP, { isCreate: !existing })
  applyMetadata(payload, set)
  applyLockedFields(payload, set, unset)
  set.showId = showId
  set.seasonId = season._id
  set.showTitle = show.title
  set.seasonNumber = seasonNumber
  set.episodeNumber = episodeNumber
  set.updatedAt = new Date()

  if (existing) {
    const update = { $set: set }
    if (Object.keys(unset).length) update.$unset = unset
    await episodesCol.updateOne({ _id: existing._id }, update)
    revalidateMedia()
    revalidatePath(`/admin/media/tv/${showId.toString()}`)
    // Bust public episode/season/show detail pages + landing lists.
    await invalidateEpisodeDetailsCache(show.title, seasonNumber, episodeNumber)
    return ok({ id: existing._id.toString() })
  }

  const doc = {
    _id: new ObjectId(),
    type: 'episode',
    manualEntry: true,
    ...set,
    createdAt: new Date(),
  }
  try {
    await episodesCol.insertOne(doc)
  } catch (error) {
    if (isDuplicateKeyError(error)) return fail(`Episode ${episodeNumber} already exists in season ${seasonNumber}.`)
    throw error
  }

  revalidateMedia()
  revalidatePath(`/admin/media/tv/${showId.toString()}`)
  await invalidateEpisodeDetailsCache(show.title, seasonNumber, episodeNumber)
  return ok({ id: doc._id.toString() })
}

export async function deleteEpisodeAction(_prevState, payload = {}) {
  const _id = toObjectId(payload.episodeId || payload.id)
  if (!_id) return fail('A valid episode id is required.')

  const client = await clientPromise
  const col = client.db(DB_NAME).collection('FlatEpisodes')
  const existing = await col.findOne(
    { _id },
    { projection: { showTitle: 1, seasonNumber: 1, episodeNumber: 1 } }
  )
  const result = await col.deleteOne({ _id })
  if (result.deletedCount === 0) return fail('Episode not found.')

  revalidateMedia()
  if (payload.showId) revalidatePath(`/admin/media/tv/${payload.showId}`)
  if (existing?.showTitle && existing.seasonNumber != null && existing.episodeNumber != null) {
    await invalidateEpisodeDetailsCache(existing.showTitle, existing.seasonNumber, existing.episodeNumber)
  }
  return ok({ deleted: true })
}
