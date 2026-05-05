//import isAuthenticated from '../../../../utils/routeAuth'
import clientPromise from '../../../../lib/mongodb'
import { httpGet } from '@src/lib/httpHelper'
import { getFlatRequestedMedia } from '@src/utils/flatDatabaseUtils'

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
  const season = searchParams.get('season') // Parameter for TV series
  const episode = searchParams.get('episode') // Parameter for TV series
  const auto = searchParams.get('auto') === 'true'

  if (!type || !name || !language) {
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

    const captionEntry = media.captionURLs?.[language]
    if (!captionEntry?.url) {
      return new Response(JSON.stringify({ error: 'Subtitles unavailable for this language' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (type === 'tv' && !episode) {
      return new Response(JSON.stringify({ error: 'Episode number required for TV subtitles' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const subtitleUrl = captionEntry.url

    if (Boolean(process.env.DEBUG) == true) {
      console.log('Fetching subtitles with the following parameters:', {
        subtitleUrl,
        language,
        type,
        season,
        episode,
        auto,
        pending: captionEntry.pending,
      })
    }

    // Auto-caption branch: forward the user's session cookie to the processor's
    // track endpoint so it can either return 302→static SRT (file exists) or
    // 202+jobId (newly enqueued). Always convert response to VTT since the
    // static URL ends in .auto.srt regardless of what the proxy URL looks like.
    if (auto) {
      return await handleAutoCaption(req, subtitleUrl)
    }

    try {
      const { data } = await httpGet(subtitleUrl, {
        responseType: 'text',
      }, true)

      // Normalize the response data structure to handle both cached and fresh responses
      const subtitleContent = data?.data || data;

      if (!subtitleContent || typeof subtitleContent !== 'string') {
        return new Response(JSON.stringify({ error: 'Failed to fetch subtitle content' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const fileExtension = subtitleUrl.split('.').pop().toLowerCase()
      const headers = {
        'Access-Control-Allow-Origin': '*', // Allows all origins
        'Content-Type': 'text/vtt', // Always setting Content-Type to text/vtt
      }

      // Convert SRT to WebVTT if needed
      if (fileExtension === 'srt') {
        const vttData = srt2webvtt(subtitleContent)
        return new Response(vttData, { status: 200, headers: headers })
      } else {
        // Check if the VTT data is valid
        if (subtitleContent.trim() === '' || subtitleContent.toLowerCase().includes('<!doctype html>')) {
          return new Response(JSON.stringify({ error: 'Invalid subtitle format received' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response(subtitleContent, { status: 200, headers: headers })
      }
    } catch (error) {
      console.error(`Error fetching subtitle file: ${error.message}`);
      return new Response(JSON.stringify({ error: 'Failed to fetch subtitle content' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  } catch (error) {
    console.error('Failed to fetch subtitles:', error)
    return new Response(JSON.stringify({ error: 'Failed to fetch subtitles' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

async function handleAutoCaption(req, subtitleUrl) {
  const cookieHeader = req.headers.get('cookie') ?? ''
  const headers = {}
  if (cookieHeader) headers['Cookie'] = cookieHeader

  let res
  try {
    res = await fetch(subtitleUrl, {
      method: 'GET',
      redirect: 'follow',
      headers,
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Caption proxy failed: ${err.message}` }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // 202 — generation enqueued. Pass through so AutoCaptionTracks can poll the job.
  if (res.status === 202) {
    const body = await res.text()
    return new Response(body, {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!res.ok) {
    const body = await res.text()
    return new Response(body || JSON.stringify({ error: `Processor returned ${res.status}` }), {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
    })
  }

  // 200 — body should be SRT bytes (followed redirect to static .auto.srt).
  // Always SRT→VTT for the auto path; the URL extension isn't a reliable signal.
  const text = await res.text()
  const trimmed = text.trim()
  if (!trimmed) {
    return new Response(JSON.stringify({ error: 'Empty subtitle response' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const vtt = trimmed.startsWith('WEBVTT') ? text : srt2webvtt(text)
  return new Response(vtt, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'text/vtt',
    },
  })
}

function srt2webvtt(data) {
  // Add safety check
  if (!data || typeof data !== 'string') {
    console.error('srt2webvtt received invalid data:', typeof data);
    return 'WEBVTT\n\n'; // Return minimal valid WebVTT
  }
  
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
