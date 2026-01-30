import isAuthenticated, { isAuthenticatedEither } from '@src/utils/routeAuth'
import { getServer, multiServerHandler, nodeJSURL } from '@src/utils/config'
import { httpGet } from '@src/lib/httpHelper'
import { getFlatRequestedMedia } from '@src/utils/flatDatabaseUtils'

// This route is used to fetch spritesheet vtt file for a specific media item
export const GET = async (req) => {
  const authResult = await isAuthenticatedEither(req)
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

    try {
      const { data } = await httpGet(spriteURL, {
        timeout: 480000, // 8 minutes
        responseType: 'text',
      })

      if (!data) {
        return new Response(JSON.stringify({ error: 'Failed to fetch thumbnails' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (data.toLowerCase().includes('<!doctype html>')) {
        return new Response(JSON.stringify({ error: 'Invalid VTT response received' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const headers = {
        'Access-Control-Allow-Origin': '*', // Allows all origins
        'Content-Type': 'text/vtt',
      }

      return new Response(data, { status: 200, headers: headers })
    } catch (error) {
      console.error(`Error fetching thumbnails: ${error.message}`)
      return new Response(JSON.stringify({ error: 'Failed to fetch thumbnails' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  } catch (error) {
    console.error(`Error in thumbnails route: ${error.message}`)
    return new Response(JSON.stringify({ error: 'Failed to fetch chapters/thumbnails' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
