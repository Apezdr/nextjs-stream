import { getVideosWatched } from '@src/utils/auth_database'
import isAuthenticated from '@src/utils/routeAuth'

export async function GET(req) {
  // Authenticate the user
  const authResult = await isAuthenticated(req)
  if (authResult instanceof Response) {
    return authResult // Return unauthorized response if not authenticated
  }

  const watchedMedia = await getVideosWatched()

  return new Response(JSON.stringify(watchedMedia), {
    status: 200,
    headers: { 'Content-Type': 'text/json' },
  })
}
