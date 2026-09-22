/**
 * Admin proxy for the media processor's identity-provider endpoints.
 *
 *   GET  /api/authenticated/admin/identity/status     → GET  <processor>/api/identity/status
 *   GET  /api/authenticated/admin/identity/report     → GET  <processor>/api/identity/report
 *   POST /api/authenticated/admin/identity/reconcile  → POST <processor>/api/identity/reconcile
 *
 * The processor keeps the reconcile report in memory only, so a 202 from it
 * ("no reconcile has run yet", e.g. right after a restart) is passed through
 * unchanged for the page to offer a manual run. Nothing here is cached: the
 * report changes every scan tick.
 */

import { NextResponse } from 'next/server'
import { isAdmin } from '@src/utils/routeAuth'
import { getBackendAuthHeaders } from '@src/utils/backendAuth'
import clientPromise from '@src/lib/mongodb'
import { enrichIdentityReport } from '@src/utils/admin/identityReportEnrich'

const BACKEND_URL =
  process.env.NODE_SERVER_INTERNAL_URL || process.env.NODE_SERVER_URL || 'http://localhost:3000'

const ENDPOINTS = {
  GET: new Set(['status', 'report']),
  POST: new Set(['reconcile']),
}

const UPSTREAM_TIMEOUT_MS = 30_000

/**
 * The catalog's view of a set of folders: TMDB id, display title and admin id
 * per originalTitle. Lets the page pair a provider's "no file for TMDB x" with
 * the folder on disk pinned to x, whatever either side calls it.
 */
async function lookupCatalogByFolder({ movies, tv }) {
  const client = await clientPromise
  const db = client.db('Media')
  const projection = { originalTitle: 1, title: 1, 'metadata.id': 1 }
  const [movieRows, tvRows] = await Promise.all([
    movies.length ? db.collection('FlatMovies').find({ originalTitle: { $in: movies } }, { projection }).toArray() : [],
    tv.length ? db.collection('FlatTVShows').find({ originalTitle: { $in: tv } }, { projection }).toArray() : [],
  ])
  const shape = (mediaType) => (row) => ({
    mediaType,
    originalTitle: row.originalTitle,
    tmdbId: row.metadata?.id ?? null,
    title: row.title ?? null,
    id: row._id?.toString() ?? null,
  })
  return [...movieRows.map(shape('movie')), ...tvRows.map(shape('tv'))]
}

async function proxy(request, params, method) {
  const admin = await isAdmin(request)
  if (admin instanceof Response) return admin

  const { endpoint } = await params
  if (!ENDPOINTS[method].has(endpoint)) {
    return NextResponse.json({ error: `Unknown identity endpoint: ${endpoint}` }, { status: 404 })
  }

  let upstream
  try {
    upstream = await fetch(`${BACKEND_URL}/api/identity/${endpoint}`, {
      method,
      headers: { Accept: 'application/json', ...(await getBackendAuthHeaders(request)) },
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
  } catch (error) {
    return NextResponse.json(
      { error: `Media processor unreachable: ${error?.message || String(error)}` },
      { status: 502 }
    )
  }

  let body
  try {
    body = await upstream.json()
  } catch {
    return NextResponse.json(
      { error: `Media processor answered ${upstream.status} without JSON` },
      { status: 502 }
    )
  }

  // A report (from GET or from a manual reconcile) gets the catalog join; the
  // 202 "pending" and "enabled: false" answers carry no lists and pass through.
  if (upstream.status === 200 && body && Array.isArray(body.unmanaged?.items)) {
    body = await enrichIdentityReport(body, lookupCatalogByFolder)
  }

  return NextResponse.json(body, { status: upstream.status })
}

export async function GET(request, { params }) {
  return proxy(request, params, 'GET')
}

export async function POST(request, { params }) {
  return proxy(request, params, 'POST')
}
