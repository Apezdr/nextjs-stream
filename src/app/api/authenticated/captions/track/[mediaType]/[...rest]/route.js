import clientPromise from '@src/lib/mongodb'
import { httpGet } from '@src/lib/httpHelper'
import { getServer, getWebhookIdForServer } from '@src/utils/config'
import { getSession } from '@src/lib/cachedAuth'
import { srtToVtt } from '@src/lib/captions/srtToVtt'
import { checkAndRecordTrigger } from '@src/lib/captions/rateLimit'

export const GET = async (req, props) => {
  const params = await props.params
  const mediaType = params.mediaType
  const rest = Array.isArray(params.rest) ? params.rest : []

  if (mediaType !== 'movie' && mediaType !== 'tv') {
    return jsonError(400, 'Invalid mediaType')
  }

  let originalTitle, lang, season, episode
  if (mediaType === 'movie') {
    if (rest.length < 2) return jsonError(400, 'Expected /movie/{originalTitle}/{lang}')
    ;[originalTitle, lang] = rest
  } else {
    if (rest.length < 4) return jsonError(400, 'Expected /tv/{originalTitle}/{lang}/{season}/{episode}')
    ;[originalTitle, lang, season, episode] = rest
  }

  originalTitle = decodeURIComponent(originalTitle)
  lang = decodeURIComponent(lang)

  const lookup = await resolveAutoCaptionContext({ mediaType, originalTitle, lang, season, episode })
  if (!lookup) return jsonError(404, 'Media not found')

  const { entry, serverId } = lookup
  const serverConfig = serverId ? getServer(serverId) : null
  if (!serverConfig?.syncEndpoint) return jsonError(503, 'No processor server resolved for this media')

  if (entry && entry.url && !entry.pending) {
    return await fetchAndConvertSrt(entry.url)
  }

  const session = await getSession()
  const userKey = session?.user?.id || session?.user?.email
  if (!userKey) return jsonError(401, 'Authentication required to generate captions')

  const rl = checkAndRecordTrigger(userKey)
  if (!rl.allowed) {
    return new Response(
      JSON.stringify({ error: 'Rate limit exceeded', retryAfterSec: rl.retryAfterSec }),
      {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(rl.retryAfterSec) },
      }
    )
  }

  const webhookId = await getWebhookIdForServer(serverId)
  const segments = mediaType === 'movie'
    ? [encodeURIComponent(originalTitle), encodeURIComponent(lang)]
    : [
        encodeURIComponent(originalTitle),
        encodeURIComponent(lang),
        encodeURIComponent(String(season)),
        encodeURIComponent(String(episode)),
      ]
  const processorUrl = `${stripTrailingSlash(serverConfig.syncEndpoint)}/api/captions/track/${mediaType}/${segments.join('/')}`

  let processorRes
  try {
    processorRes = await fetch(processorUrl, {
      method: 'GET',
      redirect: 'manual',
      headers: webhookId ? { 'X-Webhook-ID': webhookId } : {},
    })
  } catch (err) {
    return jsonError(502, `Processor unreachable: ${err.message}`)
  }

  if (processorRes.status === 302 || processorRes.status === 301) {
    const location = processorRes.headers.get('location')
    if (!location) return jsonError(502, 'Processor returned redirect with no Location')
    return await fetchAndConvertSrt(location)
  }

  if (processorRes.status === 202) {
    const body = await processorRes.text()
    return new Response(body, {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const body = await processorRes.text()
  return new Response(body || JSON.stringify({ error: 'Processor error' }), {
    status: processorRes.status,
    headers: { 'Content-Type': processorRes.headers.get('content-type') ?? 'application/json' },
  })
}

async function fetchAndConvertSrt(srtUrl) {
  try {
    const { data } = await httpGet(srtUrl, { responseType: 'text' }, true)
    const subtitleContent = data?.data ?? data
    if (!subtitleContent || typeof subtitleContent !== 'string') {
      return jsonError(502, 'Failed to fetch subtitle content')
    }
    const ext = srtUrl.split('?')[0].split('.').pop().toLowerCase()
    const vtt = ext === 'srt' ? srtToVtt(subtitleContent) : subtitleContent
    return new Response(vtt, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'text/vtt',
        'Cache-Control': 'public, max-age=300',
      },
    })
  } catch (err) {
    return jsonError(502, `Failed to fetch subtitle: ${err.message}`)
  }
}

async function resolveAutoCaptionContext({ mediaType, originalTitle, lang, season, episode }) {
  const client = await clientPromise
  const db = client.db('Media')

  if (mediaType === 'movie') {
    const movie = await db.collection('FlatMovies').findOne({ originalTitle })
    if (!movie) return null
    const entry = findAutoCaptionEntry(movie.captionURLs, lang)
    const serverId = entry?.sourceServerId || movie.videoSource || null
    return { entry, serverId }
  }

  const show = await db.collection('FlatTVShows').findOne({ originalTitle })
  if (!show) return null

  const ep = await db.collection('FlatEpisodes').findOne({
    showId: show._id,
    seasonNumber: parseInt(season, 10),
    episodeNumber: parseInt(episode, 10),
  })
  if (!ep) return null

  const entry = findAutoCaptionEntry(ep.captionURLs, lang)
  const serverId = entry?.sourceServerId || ep.videoSource || show.videoSource || null
  return { entry, serverId }
}

function findAutoCaptionEntry(captionURLs, lang) {
  if (!captionURLs || typeof captionURLs !== 'object') return null
  for (const [, value] of Object.entries(captionURLs)) {
    if (value?.autoGenerated && value?.srcLang === lang) return value
  }
  return null
}

function stripTrailingSlash(s) {
  return s.endsWith('/') ? s.slice(0, -1) : s
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
