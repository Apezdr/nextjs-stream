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
import { getFileServerImportSettings } from '@src/utils/sync_db'
import { getAllServers } from '@src/utils/config'
import { exec } from 'child_process'
import clientPromise from '@src/lib/mongodb'
import { getCpuUsage, getMemoryTotal, getMemoryUsage, getMemoryUsed } from '@src/utils/monitor_server_load'
import { fetchProcesses } from '@src/utils/server_track_processes'
import { syncAllServers } from '@src/utils/sync'
import { getSyncVerificationReport } from '@src/utils/sync_verification'

/**
 * Extracts all server endpoints from the configuration.
 * @returns {Array<Object>} Array of server endpoints with relevant URLs.
 */
function extractServerEndpoints() {
  const servers = getAllServers()
  return servers
}

/**
 * Fetches the latest image digest from Docker Hub for a given repository.
 * @param {string} repo - The Docker repository name
 * @returns {Promise<Object>} Image digest info
 */
const getDockerHubDigest = async (repo) => {
  const url = `https://hub.docker.com/v2/repositories/${repo}/tags/latest/`
  
  try {
    const response = await axios.get(url)
    const data = response.data

    if (!data || data.length === 0) {
      throw new Error(`No image information found for ${repo}`)
    }

    const digest = data.digest
    if (!digest) {
      throw new Error(`Digest not found for ${repo}`)
    }

    return { digest, last_updated: data.last_updated }
  } catch (error) {
    throw new Error(`Failed to fetch Docker Hub digest for ${repo}: ${error.message}`)
  }
}

/**
 * Fetches the current image digest from the server.
 * @param {string} repo - The Docker repository name
 * @returns {Promise<string>} Image digest
 */
const getServerImageDigest = (repo) => {
  return new Promise((resolve, reject) => {
    const command = `docker inspect --format="{{index .RepoDigests 0}}" ${repo}:latest`

    exec(command, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(`Failed to fetch server image digest for ${repo}: ${stderr || error.message}`))
      }

      const fullDigest = stdout.trim()
      if (!fullDigest) {
        return reject(new Error(`No digest found for image ${repo}:latest`))
      }

      const digestMatch = fullDigest.match(/@(.+)/)
      if (!digestMatch || !digestMatch[1]) {
        return reject(new Error(`Invalid digest format for image ${repo}:latest`))
      }

      resolve(digestMatch[1])
    })
  })
}

export async function GET(request, props) {
  const params = await props.params
  const authResult = await isAdmin(request)
  if (authResult instanceof Response) {
    return authResult
  }

  const slugs = params.admin

  if (!slugs || slugs.length === 0 || slugs[0] !== 'admin') {
    return new Response(JSON.stringify({ error: 'Invalid endpoint' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

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
        
      case 'servers':
        {
          responseData = extractServerEndpoints()
        }
        break
      
      case 'dockerhub-lastupdated':
        {
          const repos = [
            "membersolo/nextjs-stream-media-processor",
            "membersolo/nextjs-stream",
          ]      
          const results = await Promise.all(
            repos.map(async (repo) => {
              let dockerHubDigest = null
              let serverDigest = null
              let errors = []
              
              try {
                dockerHubDigest = await getDockerHubDigest(repo)
              } catch (err) {
                console.error(`Error fetching Docker Hub digest for ${repo}:`, err)
                errors.push(`Docker Hub: ${err.message}`)
              }

              try {
                serverDigest = await getServerImageDigest(repo)
              } catch (err) {
                console.error(`Error fetching Server digest for ${repo}:`, err)
                errors.push(`Server: ${err.message}`)
              }

              const isUpToDate = dockerHubDigest?.digest === serverDigest
              const returnData = { 
                repo,
                dockerHubDigest: dockerHubDigest || null, 
                serverDigest: serverDigest || null, 
                isUpToDate,
                last_updated: dockerHubDigest?.last_updated || null
              }

              if (errors.length > 0) {
                returnData.errors = errors
              }

              return returnData
            })
          )
          responseData = results
        }
        break

      case 'server-load':
        {
          const cpu = getCpuUsage()
          const memoryUsage = getMemoryUsage()
          const memoryUsed = getMemoryUsed()
          const memoryTotal = getMemoryTotal()
          responseData = {
            cpu,
            memoryUsed,
            memoryTotal,
            memoryUsage
          }
        }
        break

      case 'server-processes':
        {
          const processes = await fetchProcesses()
          responseData = processes
        }
        break
      case 'sync-verification':
        {
          // Get query parameter for comparison with file servers
          const url = new URL(request.url);
          const compareWithFileServers = url.searchParams.get('compare') !== 'false';
          
          responseData = await getSyncVerificationReport(compareWithFileServers);
          
          // Add extra context for better diagnostics
          responseData.generatedAt = new Date().toISOString();
          responseData.servers = getAllServers().map(server => server.id);
          
          // Reorganize response to highlight the most important information first
          if (responseData.issueSummary) {
            responseData = {
              // Quick overview at the top
              overview: {
                totalIssues: responseData.totalIssues,
                totalMedia: responseData.totalMedia,
                issuePercentage: responseData.issuePercentage,
                generatedAt: responseData.generatedAt,
                servers: responseData.servers
              },
              // Top-level issue summary by category
              topIssues: responseData.issueSummary.topIssues,
              // Detailed breakdown by issue pattern
              issuePatterns: responseData.issueSummary.byPattern,
              // Original issue summary for full detail
              issueSummary: {
                total: responseData.issueSummary.total,
                byCategory: responseData.issueSummary.byCategory
              },
              // Stats about overall content
              stats: responseData.stats,
              // Rest of the data
              ...responseData
            };
            
            // Remove duplicated data to clean up the response
            delete responseData.issueSummary.topIssues;
            delete responseData.issueSummary.byPattern;
          }
        }
        break
      default: {
        return new Response(JSON.stringify({ error: 'No valid data type specified' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }
  } catch (error) {
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

// Track ongoing sync operations
let startTime = null
let activeSyncOperation = null
let syncSubscribers = []

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
      // If there's an active sync operation, add this request to subscribers
      if (activeSyncOperation) {
        const result = await new Promise((resolve, reject) => {
          syncSubscribers.push({ resolve, reject })
        })
        return new Response(
          JSON.stringify({
            success: true,
            message: 'Sync operation completed successfully.',
            startTime,
            ...result,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      startTime = new Date().toISOString()
      activeSyncOperation = handleSync(webhookId, request)

      try {
        const result = await activeSyncOperation
        
        syncSubscribers.forEach(subscriber => {
          subscriber.resolve(result)
        })

        return new Response(
          JSON.stringify({
            success: true,
            message: 'Sync operation completed successfully.',
            startTime,
            ...result,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      } catch (error) {
        syncSubscribers.forEach(subscriber => {
          subscriber.reject(error)
        })
        throw error
      } finally {
        activeSyncOperation = null
        syncSubscribers = []
      }
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

  return new Response(JSON.stringify({ error: 'Unsupported operation' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Handles sync operation.
 * @param {string|null} webhookId - Webhook ID
 * @param {Request} request - Request object
 * @returns {Promise<Object>} Sync results
 */
async function handleSync(webhookId, request) {
  try {
    const headers = {}
    if (webhookId) headers['X-Webhook-ID'] = webhookId
    if (request.headers.get('cookie')) headers['cookie'] = request.headers.get('cookie')

    let response;
    try {
      response = await axios.get(buildURL('/api/authenticated/list'), { headers });
    } catch (error) {
      if (error.response && error.response.status === 502) {
        throw new Error('Bad Gateway: Failed to fetch data from the server.');
      }
      throw error;
    }
    const { fileServers, currentDB, errors } = await response.data

    // Initialize field-level availability maps
    const fieldAvailability = {
      movies: {},
      tv: {},
    }

    // Build availability maps per server
    for (const [serverId, fileServer] of Object.entries(fileServers)) {
      // For Movies
      for (const [movieTitle, movieData] of Object.entries(fileServer.movies || {})) {
        if (!fieldAvailability.movies[movieTitle]) {
          fieldAvailability.movies[movieTitle] = {}
        }

        collectFieldAvailability(movieData, '', serverId, fieldAvailability.movies[movieTitle])
      }

      // For TV Shows
      for (const [showTitle, showData] of Object.entries(fileServer.tv || {})) {
        if (!fieldAvailability.tv[showTitle]) {
          fieldAvailability.tv[showTitle] = {}
        }

        collectFieldAvailability(showData, '', serverId, fieldAvailability.tv[showTitle])
      }
    }

    const importSettings = await getFileServerImportSettings()
    console.log('Import Settings:', importSettings)

    return await syncAllServers(currentDB, fileServers, fieldAvailability)
  } catch (error) {
    console.error('Sync operation failed:', error)
    throw error
  }
}

/**
 * Collects field availability information.
 * @param {Object} mediaData - Media data
 * @param {string} currentPath - Current field path
 * @param {string} serverId - Server ID
 * @param {Object} availabilityMap - Field availability map
 */
function collectFieldAvailability(mediaData, currentPath, serverId, availabilityMap) {
  for (const key in mediaData) {
    if (!mediaData.hasOwnProperty(key)) continue

    const value = mediaData[key]
    let newPath = currentPath ? `${currentPath}.${key}` : key

    if (Array.isArray(value)) {
      if (key === 'fileNames') {
        continue
      } else if (key === 'audio' || key === 'video') {
        value.forEach((item, index) => {
          const trackType = item.codec || index
          const arrayPath = `${newPath}.${trackType}`
          collectFieldAvailability(item, arrayPath, serverId, availabilityMap)
        })
      } else {
        value.forEach((item, index) => {
          if (item && typeof item === 'object') {
            let identifier = item.name || item.id || index
            const arrayPath = `${newPath}.${identifier}`
            collectFieldAvailability(item, arrayPath, serverId, availabilityMap)
          }
        })
      }
    } else if (typeof value === 'object' && value !== null) {
      collectFieldAvailability(value, newPath, serverId, availabilityMap)
    } else {
      if (!availabilityMap[newPath]) {
        availabilityMap[newPath] = []
      }
      if (!availabilityMap[newPath].includes(serverId)) {
        availabilityMap[newPath].push(serverId)
      }
    }
  }
}

export async function DELETE(request, props) {
  const params = await props.params
  const authResult = await isAdminOrWebhook(request)
  if (authResult instanceof Response) {
    return authResult
  }
  const slugs = params.admin
  const syncOperation = slugs.includes('wipe-db') && slugs[0] === 'admin'
  if (syncOperation) {
    try {
      const client = await clientPromise
      const db = client.db('Media')

      const collections = ['Movies', 'TV']
      for (const collectionName of collections) {
        const collection = db.collection(collectionName)
        await collection.deleteMany({})
      }
      
      console.log('Cleared all documents from collections')
      return new Response(JSON.stringify({ message: 'Cleared all documents from collections' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      console.error('Error clearing collections:', error)
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }
}
