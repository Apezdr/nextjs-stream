import fetch from 'node-fetch'
//import isAuthenticated from '../../../../utils/routeAuth'
import clientPromise from '../../../../lib/mongodb'

// This route is used to fetch subtitles for a specific media item
// It is not protected by authentication because it is used by the media player
// from many different devices
export const GET = async (req) => {
  /*
  const authResult = await isAuthenticated(req);
  if (authResult instanceof Response) {
    return authResult; // Stop execution and return the unauthorized response
  }
  */

  const searchParams = req.nextUrl.searchParams
  const name = searchParams.get('name')
  const type = searchParams.get('type')
  const season = searchParams.get('season') // New parameter for TV series
  const episode = searchParams.get('episode') // New parameter for TV series

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

    if (type === 'movie') {
      media = await client
        .db('Media')
        .collection(collectionName)
        .findOne({ title: decodeURIComponent(name) })
    } else if (type === 'tv') {
      // Query for TV series
      media = await client
        .db('Media')
        .collection(collectionName)
        .findOne({
          title: decodeURIComponent(name),
          'seasons.seasonNumber': parseInt(season),
        })
    }

    if (!media) {
      return new Response(JSON.stringify({ error: 'Media not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    let chapterURL

    if (type === 'movie') {
      chapterURL = media.chapterURL
    } else if (type === 'tv') {
      // Extract chapterURL for the specific season and episode
      const selectedSeason = media.seasons.find((s) => s.seasonNumber === parseInt(season))
      const selectedEpisode = selectedSeason?.episodes.find(
        (e) => e.episodeNumber === parseInt(episode)
      )
      chapterURL = selectedEpisode?.chapterURL
    }

    if (!chapterURL) {
      return new Response(JSON.stringify({ error: 'Chapters unavailable' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const response = await fetch(chapterURL)
    const data = await response.text()

    const headers = {
      'Access-Control-Allow-Origin': '*', // Allows all origins
      'Content-Type': 'text/vtt',
    }

    return new Response(data, { status: 200, headers: headers })
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Failed to fetch chapters' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
