import { buildURL } from '@src/utils'
import { isAdmin, isAdminOrWebhook } from '../../../../utils/routeAuth'
import {
  getAllMedia,
  getAllUsers,
  getLastSynced,
  getRecentlyWatched,
} from '@src/utils/admin_database'
import {
  fetchRadarrQueue,
  fetchSABNZBDQueue,
  fetchSonarrQueue,
  fetchTdarrQueue,
  processMediaData,
  processUserData,
} from '@src/utils/admin_utils'
import axios from 'axios'
import chalk from 'chalk'
import {
  syncBackdrop,
  syncBlurhash,
  syncCaptions,
  syncChapters,
  syncEpisodeThumbnails,
  syncVideoInfo,
  syncLogos,
  syncMetadata,
  syncMissingMedia,
  syncPosterURLs,
  syncVideoURL,
  updateLastSynced,
  identifyMissingMedia,
} from '@src/utils/sync'
import { getFileServerImportSettings } from '@src/utils/sync_db'

export async function GET(request, props) {
  const params = await props.params
  const authResult = await isAdmin(request)
  if (authResult instanceof Response) {
    return authResult
  }

  const slugs = params.admin // This is an array

  // Determine the specific data type being requested
  if (!slugs || slugs.length === 0 || slugs[0] !== 'admin') {
    return new Response(JSON.stringify({ error: 'Invalid endpoint' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // The data type is the second slug, e.g., 'media', 'users', 'sabnzbd', etc.
  const dataType = slugs[1]

  if (!dataType) {
    return new Response(JSON.stringify({ error: 'No data type specified' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let responseData = {}

  try {
    switch (dataType.toLowerCase()) {
      case 'media':
        {
          const allRecords = await getAllMedia()
          responseData = { processedData: processMediaData(allRecords) }
        }
        break

      case 'users':
        {
          const allUsers = await getAllUsers()
          responseData = { processedUserData: processUserData(allUsers) }
        }
        break

      case 'recently-watched':
        {
          const recentlyWatched = await getRecentlyWatched()
          responseData = recentlyWatched
        }
        break

      case 'lastsynced':
        {
          const lastSynced = await getLastSynced()
          responseData = { lastSyncTime: lastSynced }
        }
        break

      case 'sabnzbd':
        {
          const sabnzbdQueue = await handleQueueFetch(fetchSABNZBDQueue, 'SABNZBD')
          responseData = sabnzbdQueue
        }
        break

      case 'radarr':
        {
          const radarrQueue = await handleQueueFetch(fetchRadarrQueue, 'Radarr')
          responseData = radarrQueue
        }
        break

      case 'sonarr':
        {
          const sonarrQueue = await handleQueueFetch(fetchSonarrQueue, 'Sonarr')
          responseData = sonarrQueue
        }
        break

      case 'tdarr':
        {
          const tdarrQueue = await handleQueueFetch(fetchTdarrQueue, 'Tdarr')
          responseData = tdarrQueue
        }
        break

      default:
        {
          return new Response(JSON.stringify({ error: 'No valid data type specified' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }
    }
  } catch (error) {
    // Handle errors thrown by handleQueueFetch or any other function
    //console.error(`Error fetching ${dataType} data:`, error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: error.statusCode || 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify(responseData), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

// New POST method for handling the sync operation
export async function POST(request, props) {
  const params = await props.params
  const authResult = await isAdminOrWebhook(request)
  if (authResult instanceof Response) {
    return authResult
  }
  const webhookId = request.headers.get('X-Webhook-ID') ?? null

  const slugs = params.admin
  const syncOperation = slugs.includes('sync') && slugs[0] === 'admin'

  if (syncOperation) {
    try {
      const { missingMedia, missingMp4 } = await handleSync(webhookId, request)
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Sync operation completed successfully.',
          missingMedia,
          missingMp4,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    } catch (error) {
      console.error('Sync operation failed:', error)
      return new Response(
        JSON.stringify({ error: 'Sync operation failed', details: error.toString() }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }
  }

  // Handle other POST operations or return an error for unsupported operations
  return new Response(JSON.stringify({ error: 'Unsupported operation' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function handleSync(webhookId, request) {
  try {
    // Fetch data from all configured servers
    const headers = {}
    if (webhookId) headers['X-Webhook-ID'] = webhookId
    if (request.headers.get('cookie')) headers['cookie'] = request.headers.get('cookie')

    const response = await axios.get(buildURL('/api/authenticated/list'), { headers })
    const { fileServers, currentDB, errors } = await response.data

    const startTime = Date.now()
    console.info(
      chalk.bold.dim(`⋄⋄ Starting Multi-Server Sync ⋄⋄ [${new Date(startTime).toISOString()}]`)
    )

    const importSettings = await getFileServerImportSettings()
    console.log('Import Settings:', importSettings)

    const results = {
      missingMedia: {},
      missingMp4: {},
      errors: errors || []
    }

    // Process each server sequentially to avoid overwhelming the system
    for (const [serverId, fileServer] of Object.entries(fileServers)) {
      console.info(chalk.bold.cyan(`\nProcessing server: ${serverId}`))
      
      try {
        const serverConfig = {
          id: serverId,
          ...fileServer.config
        }

        // Identify missing media for this server
        const { missingMedia, missingMp4 } = await identifyMissingMedia(fileServer, currentDB)
        results.missingMedia[serverId] = missingMedia
        results.missingMp4[serverId] = missingMp4

        // Perform sync operations with server-specific configuration
        await syncMissingMedia(missingMedia, fileServer, serverConfig)
        await syncMetadata(currentDB, fileServer, serverConfig)
        await syncCaptions(currentDB, fileServer, serverConfig)
        await syncChapters(currentDB, fileServer, serverConfig)
        await syncVideoURL(currentDB, fileServer, serverConfig)
        await syncLogos(currentDB, fileServer, serverConfig)
        await syncVideoInfo(currentDB, fileServer, serverConfig)
        await syncEpisodeThumbnails(currentDB, fileServer, serverConfig)
        await syncPosterURLs(currentDB, fileServer, serverConfig)
        await syncBackdrop(currentDB, fileServer, serverConfig)
        await syncBlurhash(currentDB, fileServer, serverConfig)

      } catch (error) {
        console.error(`Error processing server ${serverId}:`, error)
        results.errors.push({
          serverId,
          error: error.message,
          phase: 'sync'
        })
      }
    }

    await updateLastSynced()

    const endTime = Date.now()
    const duration = (endTime - startTime) / 1000
    console.info(
      chalk.bold.dim(
        `⋄⋄ Finished Multi-Server Sync ⋄⋄ [${new Date(endTime).toISOString()}] (Total Runtime: ${duration.toFixed(2)}s)`
      )
    )

    return results

  } catch (error) {
    console.error('Sync operation failed:', error)
    throw error
  }
}
