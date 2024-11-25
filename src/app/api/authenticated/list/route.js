import { getAllServers, getSyncUrls } from '@src/utils/config'
import { isAdminOrWebhook } from '../../../../utils/routeAuth'
import { getAllMedia } from '@src/utils/admin_database'

/**
 * Fetches data from a specific server
 * @param {Object} server - Server configuration
 * @returns {Promise<Object>} Server data
 */
async function fetchServerData(server) {
  const syncUrls = getSyncUrls(server.id)
  
  try {
    const [tvResponse, moviesResponse] = await Promise.all([
      fetch(syncUrls.tv),
      fetch(syncUrls.movies)
    ])

    const [tvData, moviesData] = await Promise.all([
      tvResponse.json(),
      moviesResponse.json()
    ])

    return {
      id: server.id,
      baseURL: server.baseURL,
      prefixPath: server.prefixPath,
      data: {
        tv: tvData,
        movies: moviesData
      }
    }
  } catch (error) {
    console.error(`Error fetching data from server ${server.id}:`, error)
    return {
      id: server.id,
      baseURL: server.baseURL,
      prefixPath: server.prefixPath,
      error: error.message,
      data: null
    }
  }
}

export const GET = async (req) => {
  const authResult = await isAdminOrWebhook(req)
  if (authResult instanceof Response) {
    return authResult
  }

  try {
    // Get current database state
    const { movies, tv } = await getAllMedia()
    const currentDB = { tv, movies }

    // Fetch data from all configured servers
    const servers = getAllServers()
    const serverDataPromises = servers.map(fetchServerData)
    const serverResults = await Promise.all(serverDataPromises)

    // Filter out failed servers and format response
    const fileServers = serverResults.reduce((acc, result) => {
      if (result.data) {
        acc[result.id] = {
          config: {
            baseURL: result.baseURL,
            prefixPath: result.prefixPath
          },
          ...result.data
        }
      }
      return acc
    }, {})

    // Collect errors from failed servers
    const errors = serverResults
      .filter(result => result.error)
      .map(result => ({
        serverId: result.id,
        error: result.error
      }))

    return new Response(
      JSON.stringify({
        fileServers,
        currentDB,
        errors: errors.length > 0 ? errors : undefined
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  } catch (error) {
    console.error('Failed to sync data:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Failed to sync data',
        details: error.message
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
}