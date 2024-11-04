import { sanitizeCardData } from '@src/utils/auth_utils'
import isAuthenticated from '../../../../utils/routeAuth'
import { getRequestedMedia } from '@src/utils/database'

export async function POST(req) {
  const authResult = await isAuthenticated(req)
  if (authResult instanceof Response) {
    return authResult
  }
  const data = await req.json()
  const { mediaType, mediaTitle } = data
  const media = await getRequestedMedia({
    type: mediaType,
    title: mediaTitle ? decodeURIComponent(mediaTitle) : null,
  })
  return new Response(JSON.stringify(media))
}

export async function GET(req) {
  const authResult = await isAuthenticated(req)
  if (authResult instanceof Response) {
    return authResult
  }
  const url = new URL(req.url)
  const mediaType = url.searchParams.get('mediaType')
  const mediaTitle = url.searchParams.get('mediaTitle')
  const mediaId = url.searchParams.get('mediaId')
  const mediaSeason = url.searchParams.get('season')
  const mediaEpisode = url.searchParams.get('episode')
  const isCard = url.searchParams.get('card')

  const mediaRequest = {
    type: mediaType,
    title: mediaTitle ? decodeURIComponent(mediaTitle) : null,
    id: mediaId ? decodeURIComponent(mediaId) : null,
  }

  if (mediaSeason && mediaSeason !== 'null') {
    mediaRequest.season = mediaSeason
  }

  if (mediaEpisode) {
    mediaRequest.episode = mediaEpisode
  }

  const media = await getRequestedMedia(mediaRequest)

  if (isCard) {
    const cardData = await sanitizeCardData(media, true)
    return new Response(JSON.stringify(cardData))
  }
  return new Response(JSON.stringify(media))
}
