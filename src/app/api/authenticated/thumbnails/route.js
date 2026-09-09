import isAuthenticated, { isAuthenticatedAndApproved } from '@src/utils/routeAuth'
import { getServer, multiServerHandler, nodeJSURL } from '@src/utils/config'
import { getFlatRequestedMedia } from '@src/utils/flatDatabaseUtils'

// This route is used to fetch spritesheet vtt file for a specific media item
export const GET = async (req) => {
  const authResult = await isAuthenticatedAndApproved(req)
  if (authResult instanceof Response) {
    return authResult // Stop execution and return the unauthorized response
  }

  const searchParams = req.nextUrl.searchParams
  const name = searchParams.get('name')
  const type = searchParams.get('type')
  const season = searchParams.get('season')
  const episode = searchParams.get('episode')

  if (!type || !name) {
    return new Response(JSON.stringify({ error: 'Missing required parameters' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    // Use the getFlatRequestedMedia function to fetch media from flat database structure
    const media = await getFlatRequestedMedia({
      type: type,
      title: decodeURIComponent(name),
      season: season,
      episode: episode,
    })

    if (!media) {
      return new Response(JSON.stringify({ error: 'Media not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Determine the server ID based on media type
    let serverId
    if (type === 'movie') {
      serverId = media.videoSource || media.videoInfoSource
    } else if (type === 'tv') {
      if (episode) {
        // For episodes, the videoSource is directly on the episode
        serverId = media.videoSource || media.videoInfoSource
      } else {
        // For TV shows or seasons without episode, we can't determine the server
        // We would need to fetch specific episode information
        return new Response(
          JSON.stringify({ error: 'Episode number required for TV thumbnails' }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }
    }

    // Access the server configuration using the media's videoSource
    const serverConfig = getServer(serverId || 'default')

    // Extract the Node.js server URL (syncEndpoint) from the server configuration
    // Using internalEndpoint for server-to-server requests; falls back to syncEndpoint if unset.
    const nodeServerUrl = serverConfig.internalEndpoint || serverConfig.syncEndpoint

    let spriteURL

    if (type === 'movie') {
      spriteURL = `${nodeServerUrl}/vtt/${type}/${encodeURIComponent(media.originalTitle)}/`
    } else if (type === 'tv') {
      spriteURL = `${nodeServerUrl}/vtt/${type}/${encodeURIComponent(media.originalTitle)}/${season}/${episode}`
    }

    if (!spriteURL) {
      return new Response(JSON.stringify({ error: 'Spritesheet unavailable' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Pass the backend's verdict through instead of flattening it to 500.
    // The scrub preview classifies on it: 200 VTT, 202 (+ Retry-After) while
    // the sprite is being generated, 404 when a title can never have one,
    // 502/504 when the backend failed or hung. `httpGet` would retry 5xx for
    // ~20 s and then throw without the status, which is how "generating",
    // "never" and "broken" all used to look identical to the client.
    //
    // The timeout stays long on purpose: today the backend holds the request
    // open while it generates (minutes for a long film), and that request
    // must not be cut off. The client probes with its own short timeout and
    // hangs up on us, which does not interrupt this upstream fetch.
    const UPSTREAM_TIMEOUT_MS = 480_000
    const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    let upstream
    try {
      upstream = await fetch(spriteURL, {
        cache: 'no-store',
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      })
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError'
      console.error(`Thumbnails upstream ${timedOut ? 'timed out' : 'unreachable'}: ${error.message}`)
      return new Response(
        JSON.stringify({ error: timedOut ? 'Thumbnail generation timed out' : 'Thumbnail backend unreachable' }),
        { status: timedOut ? 504 : 502, headers: jsonHeaders }
      )
    }

    if (upstream.status === 202) {
      // Generation in progress. Forward what the backend knows about it —
      // step, totalSteps, progress (0..1), message — so the scrub preview can
      // show how far along it is rather than an open-ended spinner.
      const retryAfter = upstream.headers.get('retry-after') || '5'
      let progress = null
      try {
        const b = await upstream.json()
        progress = {
          step: Number.isInteger(b?.step) ? b.step : undefined,
          totalSteps: Number.isInteger(b?.totalSteps) ? b.totalSteps : undefined,
          progress: Number.isFinite(b?.progress) ? Math.max(0, Math.min(1, b.progress)) : undefined,
          message: typeof b?.message === 'string' ? b.message.slice(0, 120) : undefined,
        }
      } catch {
        progress = null
      }
      return new Response(JSON.stringify({ status: 'generating', ...(progress ?? {}) }), {
        status: 202,
        headers: { ...jsonHeaders, 'Retry-After': retryAfter },
      })
    }
    if (upstream.status === 404 || upstream.status === 410) {
      return new Response(JSON.stringify({ error: 'No thumbnails for this title' }), {
        status: 404,
        headers: jsonHeaders,
      })
    }
    if (!upstream.ok) {
      console.error(`Thumbnails upstream returned ${upstream.status} for ${spriteURL}`)
      return new Response(
        JSON.stringify({ error: 'Thumbnail backend failed', upstreamStatus: upstream.status }),
        { status: 502, headers: jsonHeaders }
      )
    }

    const data = await upstream.text()
    if (!data || !data.trimStart().startsWith('WEBVTT')) {
      // HTML error pages and empty bodies have arrived here with a 200 before.
      console.error(`Thumbnails upstream returned a non-VTT body for ${spriteURL}`)
      return new Response(JSON.stringify({ error: 'Invalid VTT response received' }), {
        status: 502,
        headers: jsonHeaders,
      })
    }

    return new Response(data, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*', // Allows all origins
        'Content-Type': 'text/vtt',
      },
    })
  } catch (error) {
    console.error(`Error in thumbnails route: ${error.message}`)
    return new Response(JSON.stringify({ error: 'Failed to fetch chapters/thumbnails' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
