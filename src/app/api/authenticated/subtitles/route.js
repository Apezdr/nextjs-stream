//import isAuthenticated from '../../../../utils/routeAuth'
import clientPromise from '../../../../lib/mongodb'
import { httpGet } from '@src/lib/httpHelper'

// This route is used to fetch subtitles for a specific media item
// It is not protected by authentication because it is used by the media player
// from many different devices
export const GET = async (req) => {
  /* const authResult = await isAuthenticated(req)
  if (authResult instanceof Response) {
    return authResult // Stop execution and return the unauthorized response
  } */

  const searchParams = req.nextUrl.searchParams
  const name = searchParams.get('name')
  const language = searchParams.get('language')
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

    let subtitleUrl
    if (type === 'movie') {
      subtitleUrl = media.captionURLs[language]?.url
    } else if (type === 'tv') {
      // Extract subtitle URL for the specific season and episode
      const selectedSeason = media.seasons.find((s) => s.seasonNumber === parseInt(season))
      const selectedEpisode = selectedSeason?.episodes.find(
        (e) => e.episodeNumber === parseInt(episode)
      )
      subtitleUrl = selectedEpisode?.captionURLs[language]?.url
    }

    if (!subtitleUrl) {
      return new Response(JSON.stringify({ error: 'Subtitles unavailable' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (Boolean(process.env.DEBUG) == true) {
      console.log('Fetching subtitles with the following parameters:', {
        subtitleUrl,
        language,
        type,
        season,
        episode,
      })
    }
    
    const { data } = await httpGet(subtitleUrl, {
      responseType: 'text',
    }, true)

    const fileExtension = subtitleUrl.split('.').pop()
    const headers = {
      'Access-Control-Allow-Origin': '*', // Allows all origins
      'Content-Type': fileExtension === 'srt' ? 'text/vtt' : 'text/vtt', // Setting Content-Type
    }

    if (fileExtension === 'srt') {
      const vttData = srt2webvtt(data)
      return new Response(vttData, { status: 200, headers: headers })
    } else {
      return new Response(data, { status: 200, headers: headers })
    }
  } catch (error) {
    console.error('Failed to fetch subtitles:', error)
    return new Response(JSON.stringify({ error: 'Failed to fetch subtitles' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

function srt2webvtt(data) {
  // Remove DOS newlines
  let srt = data.replace(/\r+/g, '')

  // Trim white space start and end
  srt = srt.replace(/^\s+|\s+$/g, '')

  // Split on double newlines to get cues
  const cuelist = srt.split('\n\n')
  let result = ''

  if (cuelist.length > 0) {
    result += 'WEBVTT\n\n'
    for (let i = 0; i < cuelist.length; i++) {
      result += convertSrtCue(cuelist[i])
    }
  }

  return result
}

function convertSrtCue(caption) {
  let cue = ''
  const s = caption.split(/\n/)

  // Concatenate multi-line string separated in array into one
  while (s.length > 3) {
    for (let i = 3; i < s.length; i++) {
      s[2] += '\n' + s[i]
    }
    s.splice(3, s.length - 3)
  }

  let line = 0

  // Detect identifier
  if (!s[0].match(/\d+:\d+:\d+/) && s[1].match(/\d+:\d+:\d+/)) {
    cue += s[0].match(/\w+/) + '\n'
    line += 1
  }

  // Get time strings
  if (s[line].match(/\d+:\d+:\d+/)) {
    const m = s[line].match(/(\d+):(\d+):(\d+)(?:,(\d+))?\s*--?>\s*(\d+):(\d+):(\d+)(?:,(\d+))?/)
    if (m) {
      cue += `${m[1]}:${m[2]}:${m[3]}.${m[4]} --> ${m[5]}:${m[6]}:${m[7]}.${m[8]}\n`
      line += 1
    } else {
      // Unrecognized timestring
      return ''
    }
  } else {
    // File format error or comment lines
    return ''
  }

  // Get cue text
  if (s[line]) {
    cue += s[line] + '\n\n'
  }

  return cue
}
