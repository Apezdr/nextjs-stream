import { nodeJSURL } from '@src/utils/config'
import isAuthenticated from '@src/utils/routeAuth'

export async function GET(req, props) {
  const params = await props.params;
  const authResult = await isAuthenticated(req)
  if (authResult instanceof Response) {
    return authResult
  }

  // Extract TV show details from params
  const { show, season, episode, length } = params
  const totalLengthInSeconds = parseInt(length)
  const baseUrl = `${nodeJSURL}/frame/tv/${show}/${season}/${episode}/`
  let webVttContent = 'WEBVTT\n\n'

  // Generate thumbnails based on the video length
  for (let sec = 0; sec < totalLengthInSeconds; sec += 2) {
    // 2 seconds
    let startHours = Math.floor(sec / 3600)
    let startMinutes = Math.floor((sec % 3600) / 60)
    let startSeconds = sec % 60

    let endSec = sec + 2 // 2 seconds
    if (endSec > totalLengthInSeconds) {
      endSec = totalLengthInSeconds // Adjust end time to total length if it exceeds
    }
    let endHours = Math.floor(endSec / 3600)
    let endMinutes = Math.floor((endSec % 3600) / 60)
    let endSeconds = endSec % 60

    let startTime = `${String(startHours).padStart(2, '0')}:${String(startMinutes).padStart(
      2,
      '0'
    )}:${String(startSeconds).padStart(2, '0')}.000`
    let endTime = `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(
      2,
      '0'
    )}:${String(endSeconds).padStart(2, '0')}.000`

    webVttContent += `${startTime} --> ${endTime}\n${baseUrl}${String(startHours).padStart(
      2,
      '0'
    )}:${String(startMinutes).padStart(2, '0')}:${String(startSeconds).padStart(2, '0')}.jpg\n\n`
  }

  return new Response(webVttContent, { headers: { 'content-type': 'text/vtt' } })
}
