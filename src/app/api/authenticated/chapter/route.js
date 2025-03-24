import fetch from 'node-fetch'
//import isAuthenticated from '../../../../utils/routeAuth'
import clientPromise from '../../../../lib/mongodb'
import { getFlatRequestedMedia } from '@src/utils/flatDatabaseUtils'

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
  const season = searchParams.get('season') // Parameter for TV series
  const episode = searchParams.get('episode') // Parameter for TV series

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
      episode: episode
    })
    
    if (!media) {
      return new Response(JSON.stringify({ error: 'Media not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Extract chapterURL based on media type
    let chapterURL
    
    if (type === 'movie') {
      chapterURL = media.chapterURL
    } else if (type === 'tv') {
      // For episodes, the chapterURL is directly on the returned media object
      if (episode) {
        chapterURL = media.chapterURL
      } else {
        // For TV shows without specific episode, we can't determine chapters
        return new Response(JSON.stringify({ error: 'Episode number required for TV chapters' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    if (!chapterURL) {
      return new Response(JSON.stringify({ error: 'Chapters unavailable' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    try {
      const response = await fetch(chapterURL)
      
      if (!response.ok) {
        return new Response(JSON.stringify({ 
          error: `Failed to fetch chapters: ${response.status} ${response.statusText}` 
        }), {
          status: response.status,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      
      const data = await response.text()

      // Check if response is valid VTT format
      if (data.toLowerCase().includes('<!doctype html>') || data.trim() === '') {
        return new Response(JSON.stringify({ error: 'Invalid chapter format received' }), {
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
      console.error(`Error fetching chapter file: ${error.message}`);
      return new Response(JSON.stringify({ error: 'Failed to fetch chapters' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  } catch (error) {
    console.error(`Error in chapter route: ${error.message}`);
    return new Response(JSON.stringify({ error: 'Failed to fetch chapters' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
