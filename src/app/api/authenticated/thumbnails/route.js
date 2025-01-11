//import isAuthenticated from '../../../../utils/routeAuth'
import clientPromise from '../../../../lib/mongodb'
import isAuthenticated from '@src/utils/routeAuth'
import { getServer, multiServerHandler, nodeJSURL } from '@src/utils/config'
import { httpGet } from '@src/lib/httpHelper'

// This route is used to fetch spritesheet vtt file for a specific media item
export const GET = async (req) => {
  const authResult = await isAuthenticated(req)
  if (authResult instanceof Response) {
    return authResult // Stop execution and return the unauthorized response
  }

  const searchParams = req.nextUrl.searchParams
  const name = searchParams.get('name')
  const type = searchParams.get('type')
  const season = searchParams.get('season')
  const episode = searchParams.get('episode')

  const collectionName = type === 'movie' ? 'Movies' : type === 'tv' ? 'TV' : null

  if (!collectionName) {
    return new Response(JSON.stringify({ error: 'Invalid type specified' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const client = await clientPromise
    let media
    let serverId

    if (type === 'movie') {
      media = await client
        .db('Media')
        .collection(collectionName)
        .findOne({ title: decodeURIComponent(name) })
      serverId = media?.videoSource ?? media?.videoInfoSource
    } else if (type === 'tv') {
      // Query for TV series
      media = await client
        .db('Media')
        .collection(collectionName)
        .findOne({
          title: decodeURIComponent(name),
          'seasons.seasonNumber': parseInt(season),
        })
      const selectedSeason = media.seasons.find((s) => s.seasonNumber === parseInt(season))
      const selectedEpisode = selectedSeason?.episodes.find(
        (e) => e.episodeNumber === parseInt(episode)
      )
      serverId = selectedEpisode?.videoSource ?? selectedEpisode?.videoInfoSource
    }

    if (!media) {
      return new Response(JSON.stringify({ error: 'Media not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    // Access the server configuration using the media's videoSource
    const serverConfig = getServer(serverId || 'default')

    // Extract the Node.js server URL (syncEndpoint) from the server configuration
    const nodeServerUrl = serverConfig.syncEndpoint

    let spriteURL

    if (type === 'movie') {
      spriteURL = `${nodeServerUrl}/vtt/${type}/${name}/`
    } else if (type === 'tv') {
      spriteURL = `${nodeServerUrl}/vtt/${type}/${name}/${season}/${episode}`
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
          //status: response.status,
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
      return new Response(JSON.stringify({ error: 'Failed to fetch thumbnails' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Failed to fetch chapters/thumbnails' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
