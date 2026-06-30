'use server'

/**
 * Server Actions for reading/writing a media item's per-directory `tmdb.config`
 * on the media-processor (file server).
 *
 * The media-processor stores a `tmdb.config` JSON file inside each movie/show
 * directory (<mediaDir>/tmdb.config). It governs how the backend pulls TMDB
 * data on its next scan:
 *   - update_metadata (bool)  — allow the backend to refresh metadata from TMDB
 *   - tmdb_id (int)           — pin/correct the TMDB match
 *   - backdrop_focal          — 'left' | 'right' | 'center' | null
 *   - override_poster/backdrop/logo (string URLs) — force a specific asset
 *
 * These talk to the backend's admin endpoints (mounted at /api/admin):
 *   GET  /api/admin/metadata/config?mediaType=&mediaName=
 *   PUT  /api/admin/metadata/config   { mediaType, mediaName, config }
 *
 * Auth: the backend validates the SAME nextjs-stream session (Bearer token) and
 * requires admin — we forward the admin's session token, mirroring the existing
 * TMDB proxy (getBackendAuthHeaders). `mediaName` is the directory name, i.e.
 * the media's `originalTitle`.
 */

import { getSession } from '@src/lib/cachedAuth'
import { adminUserEmails } from '@src/utils/config'

const BACKEND_URL =
  process.env.NODE_SERVER_INTERNAL_URL || process.env.NODE_SERVER_URL || 'http://localhost:3000'

const fail = (message) => ({ status: 'error', message })

/** Admin gate + Bearer header from the current session, or an error result. */
async function authorizedHeaders() {
  const session = await getSession()
  if (!session?.user || !adminUserEmails.includes(session.user.email)) {
    return { error: fail('Not authorized.') }
  }
  const token = session?.session?.token
  if (!token) return { error: fail('No session token available.') }
  return {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  }
}

function normalizeMediaType(type) {
  // The flat docs use 'movie'/'tv'; the backend expects exactly those.
  return type === 'tv' ? 'tv' : 'movie'
}

/**
 * Load the current tmdb.config for a media item.
 * @returns {Promise<{status:'success', config:Object} | {status:'error', message:string}>}
 */
export async function getTmdbConfigAction({ mediaType, originalTitle }) {
  if (!originalTitle) return fail('originalTitle is required.')
  const auth = await authorizedHeaders()
  if (auth.error) return auth.error

  const url = new URL(`${BACKEND_URL}/api/admin/metadata/config`)
  url.searchParams.set('mediaType', normalizeMediaType(mediaType))
  url.searchParams.set('mediaName', originalTitle)

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: auth.headers,
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return fail(`Backend returned ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
    }
    const data = await res.json()
    // configPath is returned so the dialog can show which file the backend
    // actually read — invaluable when a media item lives on a non-default
    // server and the lookup silently falls back to defaults.
    return { status: 'success', config: data?.config ?? {}, configPath: data?.configPath ?? null }
  } catch (error) {
    return fail(`Failed to load TMDB config: ${error.message}`)
  }
}

/**
 * Save the tmdb.config for a media item. Normalizes the incoming form payload
 * into the backend's expected shape (the backend re-validates server-side).
 * @returns {Promise<{status:'success'|'error', message:string}>}
 */
export async function saveTmdbConfigAction(_prevState, payload = {}) {
  const { mediaType, originalTitle, config = {} } = payload
  if (!originalTitle) return fail('originalTitle is required.')
  const auth = await authorizedHeaders()
  if (auth.error) return auth.error

  // Start from the incoming config so any field the dialog doesn't manage
  // (e.g. a `metadata` override block) is preserved rather than wiped, then
  // normalize the known fields.
  const clean = { ...config }

  // tmdb_id: positive integer, or removed if blank
  if (clean.tmdb_id === undefined || clean.tmdb_id === '' || clean.tmdb_id === null) {
    delete clean.tmdb_id
  } else {
    const n = parseInt(clean.tmdb_id, 10)
    if (Number.isInteger(n) && n > 0) clean.tmdb_id = n
    else return fail('TMDB ID must be a positive integer.')
  }

  // update_metadata: coerce to boolean (default true)
  clean.update_metadata = clean.update_metadata !== false

  // backdrop_focal: one of left/right/center, else null
  clean.backdrop_focal = ['left', 'right', 'center'].includes(clean.backdrop_focal)
    ? clean.backdrop_focal
    : null

  // override_* : trim, or drop when empty
  for (const field of ['poster', 'backdrop', 'logo']) {
    const key = `override_${field}`
    const value = clean[key]
    if (typeof value === 'string' && value.trim()) clean[key] = value.trim()
    else delete clean[key]
  }

  // metadata: keep only a non-empty plain object; the backend shallow-merges it
  // over the TMDB response (applyMetadataOverrides). Drop empties so we never
  // write a bare `{}`.
  if (
    !clean.metadata ||
    typeof clean.metadata !== 'object' ||
    Array.isArray(clean.metadata) ||
    Object.keys(clean.metadata).length === 0
  ) {
    delete clean.metadata
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/admin/metadata/config`, {
      method: 'PUT',
      headers: auth.headers,
      body: JSON.stringify({
        mediaType: normalizeMediaType(mediaType),
        mediaName: originalTitle,
        config: clean,
      }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return fail(`Backend returned ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
    }
    return { status: 'success', message: 'TMDB config saved. Applied on the next sync.' }
  } catch (error) {
    return fail(`Failed to save TMDB config: ${error.message}`)
  }
}
