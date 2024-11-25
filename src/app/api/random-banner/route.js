import { fetchRandomBannerMedia } from '@src/utils/auth_database'

// Used by chromecast to fetch a random banner media
export const GET = async (req) => {

  const mediaResult = await fetchRandomBannerMedia()
  if (mediaResult.error) {
    return new Response(JSON.stringify({ error: mediaResult.error }), {
      status: mediaResult.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const imageResponse = await fetch(mediaResult.backdrop)
  const imageBuffer = await imageResponse.arrayBuffer()

  return new Response(imageBuffer, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*', // Allows all origins
      'Content-Type': imageResponse.headers.get('content-type') || 'image/jpeg',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    },
  })
}