import { syncMoviesURL, syncTVURL } from '@src/utils/config'
import { isAdminOrWebhook } from '../../../../utils/routeAuth'
import { getAllMedia } from '@src/utils/admin_database'

export const GET = async (req) => {
  const authResult = await isAdminOrWebhook(req)
  if (authResult instanceof Response) {
    return authResult
  }

  const { movies, tv } = await getAllMedia()

  try {
    const tvResponse = await fetch(syncTVURL)
    const tvData = await tvResponse.json()
    const moviesResponse = await fetch(syncMoviesURL)
    const moviesData = await moviesResponse.json()

    return new Response(
      JSON.stringify({
        fileServer: { tv: tvData, movies: moviesData },
        currentDB: { tv: tv, movies: movies },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.log(error)
    return new Response(
      JSON.stringify(
        { error: 'Failed to sync data' },
        {
          status: 500,
        }
      )
    )
  }
}
