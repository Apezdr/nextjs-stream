import isAuthenticated from '@src/utils/routeAuth'
import { fetchBannerMedia } from '@src/utils/auth_database'
import { fetchFlatBannerMedia } from '@src/utils/flatDatabaseUtils'

export const GET = async (req) => {
  const authResult = await isAuthenticated(req)
  if (authResult instanceof Response) {
    return authResult // Stop execution and return the unauthorized response
  }

  const mediaResult = await fetchFlatBannerMedia()
  if (mediaResult.error && mediaResult.details && mediaResult.status) {
    return new Response(JSON.stringify({ error: mediaResult.error, details: mediaResult.details }), {
      status: mediaResult.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify(mediaResult), {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*', // Allows all origins
      'Content-Type': 'application/json',
    },
  })
}
