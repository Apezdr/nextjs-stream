import isAuthenticated from '../../../../utils/routeAuth'
import { getRequestedMedia } from 'src/utils/database'

export async function POST(req) {
  const authResult = await isAuthenticated(req)
  if (authResult instanceof Response) {
    return authResult
  }
  const data = await req.json()
  const { mediaType, mediaTitle } = data
  const media = await getRequestedMedia(mediaType, decodeURIComponent(mediaTitle))
  return new Response(JSON.stringify(media))
}
