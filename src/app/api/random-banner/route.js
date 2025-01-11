import { httpGet } from '@src/lib/httpHelper'
import { fetchRandomBannerMedia } from '@src/utils/auth_database'

// Used by chromecast to fetch a random banner media
export const GET = async (req) => {
  try {
    // Fetch random banner media info
    const mediaResult = await fetchRandomBannerMedia()
    if (mediaResult.error) {
      return new Response(JSON.stringify({ error: mediaResult.error }), {
        status: mediaResult.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Fetch the image and convert to ArrayBuffer
    const { data: buffer, headers: imageHeaders } = await httpGet(mediaResult.backdrop, {
      responseType: 'buffer',
      headers: {
        Accept: 'image/*',
      },
    })

    // Convert Buffer to ArrayBuffer
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    )

    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': imageHeaders['content-type'] || 'image/jpeg',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    })
  } catch (error) {
    console.error('Error fetching banner image:', error)
    return new Response(JSON.stringify({ error: 'Failed to fetch banner image' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}