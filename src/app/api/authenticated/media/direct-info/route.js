/**
 * GET /api/authenticated/media/direct-info
 *
 * The authenticated proxy of jit-transcoder's `GET /stream/{key}/direct.json`
 * — the delivery-tier verdict that drives every client's quality menu
 * (FRONTEND_PLAYBACK_REQUIREMENTS.md §3, and §12.4 of the RN app's
 * front-end-api-contract.md).
 *
 * Query: `mediaType` (movie|tv), `mediaId` (Mongo _id) and/or
 * `mediaOriginalTitle`/`mediaTitle`, plus `season`+`episode` for shows — the
 * verdict is a property of the playable FILE, so an episode must identify
 * itself. Resolution mirrors /api/authenticated/media exactly, so the verdict
 * always describes the same item that route just handed the client.
 *
 * The stream key is derived from the delivered `videoURL` AFTER the serve-time
 * JIT decision (jit/preference.js): a title being served as a raw file has no
 * transcoder verdict to report, and 404 is the contract's "nothing offered" —
 * the menu simply lacks Original.
 *
 * Callers must fetch this at playback-open only. The first request for an
 * eligible title triggers the transcoder's one-time keyframe derivation.
 *
 * Statuses:
 *   200 — the enriched verdict
 *   404 — no such item, or no JIT delivery for it (treat as nothing offered)
 *   502 — the transcoder answered, badly
 *   504 — derivation still running; ask again (NOT "nothing offered")
 */

import { isAuthenticatedAndApproved } from '@src/utils/routeAuth'
import { getFlatRequestedMedia } from '@src/utils/flatDatabaseUtils'
import { applyJitPreference } from '@src/utils/jit/preference'
import { fetchDirectInfo, parseStreamUrl } from '@src/utils/jit/directInfo'
import { createLogger } from '@src/lib/logger'

const log = createLogger('API.DirectInfo')

// Same stance as the media routes: this describes a delivery decision that can
// be flipped at runtime, so nothing may hold a copy of it.
const NO_STORE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, private',
}

const json = (data, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...NO_STORE_HEADERS, ...extraHeaders },
  })

export async function GET(request) {
  const authResult = await isAuthenticatedAndApproved(request)
  if (authResult instanceof Response) {
    return authResult
  }

  const params = new URL(request.url).searchParams
  const mediaType = params.get('mediaType')
  const mediaId = params.get('mediaId')
  const mediaTitle = params.get('mediaTitle')
  const mediaOriginalTitle = params.get('mediaOriginalTitle')
  const season = params.get('season')
  const episode = params.get('episode')

  if (mediaType !== 'movie' && mediaType !== 'tv') {
    return json({ error: 'mediaType must be "movie" or "tv"' }, 400)
  }
  if (mediaType === 'tv' && (!season || !episode)) {
    // A show-level verdict would be a lie: eligibility is per file.
    return json({ error: 'season and episode are required for tv' }, 400)
  }
  if (!mediaId && !mediaTitle && !mediaOriginalTitle) {
    return json({ error: 'mediaId or mediaOriginalTitle is required' }, 400)
  }

  // originalTitle is the canonical routing key, so when a caller sends it we
  // resolve by it and drop mediaId — matching /api/authenticated/media, where
  // a dual-sending client would otherwise have the ephemeral _id win.
  const preferOriginalTitle = Boolean(mediaOriginalTitle)
  const resolvedTitle = preferOriginalTitle
    ? decodeURIComponent(mediaOriginalTitle)
    : mediaTitle
      ? decodeURIComponent(mediaTitle)
      : null

  let media
  try {
    media = await getFlatRequestedMedia({
      type: mediaType,
      title: resolvedTitle,
      id: preferOriginalTitle ? null : mediaId ? decodeURIComponent(mediaId) : null,
      ...(season ? { season: String(season) } : {}),
      ...(episode ? { episode: String(episode) } : {}),
    })
  } catch (error) {
    log.error({ err: error, mediaType, mediaId, season, episode }, 'Media lookup failed')
    return json({ error: 'Media lookup failed' }, 500)
  }

  if (!media) {
    return json({ error: 'Media not found' }, 404)
  }

  // The same serve-time decision the media payload got, so the verdict can
  // never describe a transport this viewer is not being given.
  await applyJitPreference(media)

  const stream = parseStreamUrl(media.videoURL)
  if (!stream) {
    return json({ error: 'No JIT delivery for this item' }, 404)
  }

  const result = await fetchDirectInfo(stream)

  switch (result.status) {
    case 'ok':
      return json(result.value)

    case 'pending':
      // Deliberately not a 200: a client that receives any verdict stops
      // asking, so answering "nothing offered" here would hide Original for
      // the rest of the session. The derivation continues server-side.
      return json({ error: 'Verdict pending', pending: true }, 504, { 'Retry-After': '30' })

    case 'not-found':
      return json({ error: 'Unknown stream key' }, 404)

    default:
      log.warn(
        {
          origin: stream.origin,
          upstreamStatus: result.upstreamStatus,
          err: result.error,
        },
        'direct.json upstream failure'
      )
      return json({ error: 'Transcoder unavailable' }, 502)
  }
}
