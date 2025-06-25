import { sanitizeCardData } from '@src/utils/auth_utils'
import isAuthenticated, { isAuthenticatedEither } from '../../../../utils/routeAuth'
import { getFlatRequestedMedia } from '@src/utils/flatDatabaseUtils'

export async function POST(req) {
  const authResult = await isAuthenticatedEither(req)
  if (authResult instanceof Response) {
    return authResult
  }
  const data = await req.json()
  const { mediaType, mediaTitle } = data
  const media = await getFlatRequestedMedia({
    type: mediaType,
    title: mediaTitle ? decodeURIComponent(mediaTitle) : null,
  })
  return new Response(JSON.stringify(media))
}

export async function GET(req) {
  try {
    const authResult = await isAuthenticatedEither(req)
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

    // Log request parameters for debugging
    if (Boolean(process.env.DEBUG) == true) {
      console.log(`Media API request: type=${mediaType}, id=${mediaId}, season=${mediaSeason}, episode=${mediaEpisode}, isCard=${isCard}`);
    }
    
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

    const media = await getFlatRequestedMedia(mediaRequest)
    
    if (!media) {
      console.warn(`No media found for request: ${JSON.stringify(mediaRequest)}`);
      return new Response(
        JSON.stringify({ error: 'Media not found' }),
        { status: 404 }
      )
    }

    if (isCard) {
      try {
        const cardData = await sanitizeCardData(media, true)
        return new Response(JSON.stringify(cardData))
      } catch (cardError) {
        console.error('Error in sanitizeCardData:', cardError);
        // Return partial data if possible
        return new Response(
          JSON.stringify({ 
            error: 'Error processing card data',
            partialData: media ? {
              id: media.id,
              title: media.title,
              type: media.type,
              posterURL: media.posterURL
            } : null
          }),
          { status: 206 } // Partial Content
        )
      }
    }
    return new Response(JSON.stringify(media))
  } catch (error) {
    console.error('Error in media API:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to fetch media data', 
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }),
      { status: 500 }
    )
  }
}
