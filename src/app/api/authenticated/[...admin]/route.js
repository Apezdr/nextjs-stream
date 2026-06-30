import { buildURL } from '@src/utils'
import { isAdmin, isAdminOrWebhook } from '../../../../utils/routeAuth'
import {
  getAllUsers,
  getLastSynced,
} from '@src/utils/admin_database'
import { getFlatRecentlyWatchedForUser } from '@src/utils/flatDatabaseUtils'
import { ObjectId } from 'mongodb'
import { userQueries } from '@src/lib/userQueries'
import {
  fetchRadarrQueue,
  fetchSABNZBDQueue,
  fetchSonarrQueue,
  fetchTdarrQueue,
  processUserData,
  storeSystemStatus,
} from '@src/utils/admin_utils'
import axios from 'axios'
import chalk from 'chalk'
import { getFileServerImportSettings } from '@src/utils/sync_db'
import { getAllServers } from '@src/utils/config'
import { exec } from 'child_process'
import clientPromise from '@src/lib/mongodb'
import { getCpuUsage, getMemoryTotal, getMemoryUsage, getMemoryUsed, getDiskStats } from '@src/utils/monitor_server_load'
import { fetchProcesses } from '@src/utils/server_track_processes'
import { syncAllServers } from '@src/utils/sync'
import { syncEventBus } from '@src/utils/sync/core/events'
import { SyncEventType } from '@src/utils/sync/core/types'
import { createDatabaseAdapter } from '@src/utils/sync/infrastructure'
import { getSyncVerificationReport } from '@src/utils/sync_verification'
import { handleQueueFetch } from '@src/utils/auth_utils'
import { NotificationManager } from '@src/utils/notifications/NotificationManager.js'
import { getFileServerData } from '@src/utils/fileServerDataService'
import { revalidateTag } from 'next/cache'
import {
  getAllMovieCacheTags,
  getAllTVShowCacheTags,
  getAllSeasonCacheTags,
  getAllEpisodeCacheTags,
} from '@src/utils/cache/mediaPagesTags'
import { createLogger } from '@src/lib/logger'

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
      case 'users':
        {
          const allUsers = await getAllUsers()
          responseData = { processedUserData: processUserData(allUsers) }
        }
        break

      case 'user-recently-watched':
        {
          try {
            // Get userId from path
            const userId = slugs[2];
            if (!userId) {
              throw new Error('User ID is required');
            }
            
            // Parse pagination parameters
            const url = new URL(request.url);
            const page = parseInt(url.searchParams.get('page') || '0', 10);
            const limit = parseInt(url.searchParams.get('limit') || '10', 10);
            
            // Validate user exists
            const client = await clientPromise;
            const user = await userQueries.findById(userId);
              
            if (!user) {
              throw new Error(`User with ID ${userId} not found`);
            }
            
            // Fetch data for this specific user with pagination using admin-overview projection
            const watchedMedia = await getFlatRecentlyWatchedForUser({
              userId: userId,
              page: page,
              limit: limit,
              countOnly: false,
              projection: 'admin-overview',
              contextHints: { isAdmin: true }
            });
            
            // Get total count for pagination info
            const totalCount = await getFlatRecentlyWatchedForUser({
              userId: userId,
              countOnly: true,
              projection: 'admin-overview',
              contextHints: { isAdmin: true }
            });
            
            // Format response with pagination metadata
            responseData = {
              data: watchedMedia || [],
              user: {
                id: user._id.toString(),
                name: user.name,
                image: user.image
              },
              pagination: {
                page,
                limit,
                total: totalCount,
                totalPages: Math.ceil(totalCount / limit),
                hasMore: (page + 1) * limit < totalCount
              }
            };
          } catch (error) {
            console.error(`Error fetching user recently watched: ${error.message}`);
            return new Response(JSON.stringify({ error: error.message }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        }
        break;
        
      case 'recently-watched':
        {
          try {
            // Get all users
            const client = await clientPromise
            const users = await userQueries.findAll()
            
            // For each user, get their recently watched media using the flat database approach
            const lastWatchedPromises = users.map(async (user) => {
              try {
                // Use flat database function to get recently watched items with admin-overview projection
                const watchedMedia = await getFlatRecentlyWatchedForUser({
                  client,
                  userId: user._id,
                  page: 0,
                  limit: 4, // Same limit as legacy function
                  countOnly: false,
                  projection: 'admin-overview',
                  contextHints: { isAdmin: true }
                })
                
                // Get total count for accurate "+X more" calculation
                const totalCount = await getFlatRecentlyWatchedForUser({
                  client,
                  userId: user._id,
                  countOnly: true,
                  projection: 'admin-overview',
                  contextHints: { isAdmin: true }
                })
                
                // Skip if no watched media found
                if (!watchedMedia || watchedMedia.length === 0) {
                  return null
                }
                
                // Find the most recent watch time
                let mostRecentWatch = null
                watchedMedia.forEach(media => {
                  const lastUpdated = media.lastWatchedTimestamp
                  if (lastUpdated && (!mostRecentWatch || lastUpdated > mostRecentWatch)) {
                    mostRecentWatch = lastUpdated
                  }
                })
                
                // Format the data to match the structure expected by the component
                return {
                  user: {
                    _id: user._id.toString(), // Add the user ID for the modal functionality
                    name: user.name,
                    image: user.image,
                  },
                  videos: watchedMedia,
                  totalCount: totalCount || 0, // Add total count for accurate display
                  mostRecentWatch
                }
              } catch (userError) {
                console.error(`Error processing flat recently watched for user ${user.name}: ${userError.message}`)
                return null
              }
            })
            
            const recentlyWatched = await Promise.all(lastWatchedPromises)
            // Filter out nulls and sort by most recent watch
            responseData = recentlyWatched
              .filter(entry => entry)
              .sort((a, b) => {
                if (!a.mostRecentWatch && !b.mostRecentWatch) return 0
                if (!a.mostRecentWatch) return 1
                if (!b.mostRecentWatch) return -1
                return new Date(b.mostRecentWatch) - new Date(a.mostRecentWatch)
              })
          } catch (error) {
            console.error(`Error in recently-watched endpoint: ${error.message}`)
          }
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
            memoryUsage,
            drives: getDiskStats(),
          }
        }
        break

      case 'server-processes':
        {
          const processes = await fetchProcesses()
          responseData = processes
        }
        break
      case 'sync-status':
        responseData = {
          active: activeSyncOperation !== null,
          startTime: activeSyncOperation ? startTime : null,
          streamUrl: activeSyncOperation ? '/api/authenticated/admin/sync-stream' : null,
          snapshot: syncSnapshot ? {
            servers: syncSnapshot.servers,
            totals: syncSnapshot.totals,
          } : null,
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

// Running snapshot of sync state — updated live via event bus subscriptions.
// Exposed through sync-status so late-joining clients can catch up without
// relying on event bus history (which may overflow for large syncs).
let syncSnapshot = null
let snapshotUnsubs = []

const SNAPSHOT_SENTINELS = new Set(['__sync_complete__', '__server_complete__', '__server_start__', '__sync_warmup__'])

function startSnapshotTracking() {
  syncSnapshot = { servers: {}, totals: { processed: 0, errors: 0 } }

  const handle = (event) => {
    if (!syncSnapshot) return
    const sid = event.serverId

    if (event.entityId === '__sync_warmup__') return

    if (event.entityId === '__server_start__') {
      syncSnapshot.servers[sid] = { id: sid, status: 'syncing', currentEntity: null, currentOperation: null, processed: 0, errorCount: 0, errors: [] }
      return
    }

    if (event.entityId === '__server_complete__') {
      const s = syncSnapshot.servers[sid] || { id: sid, processed: 0, errorCount: 0, errors: [] }
      syncSnapshot.servers[sid] = { ...s, status: 'complete', currentEntity: null, currentOperation: null }
      return
    }

    if (event.entityId === '__sync_complete__') {
      syncSnapshot = null  // Sync done — clear snapshot
      return
    }

    // Regular entity event
    if (!syncSnapshot.servers[sid]) {
      syncSnapshot.servers[sid] = { id: sid, status: 'syncing', currentEntity: null, currentOperation: null, processed: 0, errorCount: 0, errors: [] }
    }
    const s = syncSnapshot.servers[sid]

    if (event.type === 'started' || event.type === 'progress') {
      s.currentEntity = event.entityId || null
      s.currentOperation = event.operation || null
    }

    if (event.type === 'complete' && !SNAPSHOT_SENTINELS.has(event.entityId)) {
      s.processed = (s.processed || 0) + 1
      s.currentEntity = event.entityId || null
      s.currentOperation = event.operation || null
      syncSnapshot.totals.processed++
    }

    if (event.type === 'error' && event.error) {
      s.errorCount = (s.errorCount || 0) + 1
      s.errors = [...(s.errors || []), { entityId: event.entityId, mediaType: event.mediaType, operation: event.operation || null, error: event.error }]
      syncSnapshot.totals.errors++
    }
  }

  for (const type of [SyncEventType.Started, SyncEventType.Progress, SyncEventType.Complete, SyncEventType.Error]) {
    snapshotUnsubs.push(syncEventBus.subscribe(type, handle))
  }
}

function stopSnapshotTracking() {
  for (const unsub of snapshotUnsubs) unsub()
  snapshotUnsubs = []
  syncSnapshot = null
}

/**
 * Handle system status notification webhook request
 * @param {Request} request - The request object
 * @param {string} webhookId - The webhook ID from the request
 * @param {string} serverId - The server ID associated with the webhook
 * @returns {Promise<Response>} - Response to the webhook
 */
async function handleSystemStatusNotification(request, webhookId, serverId) {
  try {
    // Verify this is a webhook request
    if (!webhookId) {
      return new Response(JSON.stringify({ 
        error: 'Unauthorized', 
        message: 'This endpoint requires webhook authentication' 
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // Get status data from request body
    let statusData;
    try {
      statusData = await request.json();
    } catch (error) {
      return new Response(JSON.stringify({ 
        error: 'Bad Request', 
        message: 'Invalid JSON in request body' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // Validate status data
    if (!statusData || typeof statusData !== 'object') {
      return new Response(JSON.stringify({ 
        error: 'Bad Request', 
        message: 'Invalid status data format' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // Store the status data (indicate this is from a webhook)
    await storeSystemStatus(statusData, serverId, true);
    
    // Return success response
    return new Response(JSON.stringify({ 
      success: true,
      message: 'System status notification received and processed',
      receivedAt: new Date().toISOString(),
      serverId
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error processing system status notification:', error);
    
    return new Response(JSON.stringify({ 
      error: 'Internal Server Error', 
      message: 'Failed to process system status notification',
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle the post-sync media cache revalidation request.
 *
 * Why this exists as a separate route: the admin sync is fire-and-forget
 * (handleSyncOperation returns a 202 before handleSync completes), so calling
 * revalidateTag from inside the sync is a silent no-op — Next flushes a request's
 * pending tags (withExecuteRevalidates) the moment the route handler resolves,
 * which for the sync is the 202, long before any entity is written. This handler
 * runs in its own fresh, short-lived request scope where revalidateTag actually
 * commits. The sync POSTs the set of changed entities here when it finishes.
 *
 * Body: { movies: string[], shows: string[],
 *         seasons: {title,season}[], episodes: {title,season,episode}[] }
 * All titles are DISPLAY titles (media page tags key on the display title).
 *
 * @param {Request} request - The request object
 * @returns {Promise<Response>}
 */
async function handleRevalidateMedia(request) {
  const log = createLogger('Cache.RevalidateMedia')

  let payload
  try {
    payload = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const movies = Array.isArray(payload?.movies) ? payload.movies : []
  const shows = Array.isArray(payload?.shows) ? payload.shows : []
  const seasons = Array.isArray(payload?.seasons) ? payload.seasons : []
  const episodes = Array.isArray(payload?.episodes) ? payload.episodes : []

  // Build a deduped set of tags before revalidating. Dedup matters: the global
  // bucket tags ('tv', 'media-library', '*-details') and a show's tag repeat
  // across every season/episode of that show — marking each stale once is enough,
  // and it keeps the unique-tag count an honest over-invalidation signal.
  const tags = new Set()
  for (const title of movies) {
    if (title) for (const t of getAllMovieCacheTags(title)) tags.add(t)
  }
  for (const title of shows) {
    if (title) for (const t of getAllTVShowCacheTags(title)) tags.add(t)
  }
  for (const s of seasons) {
    if (s?.title && s.season != null) {
      for (const t of getAllSeasonCacheTags(s.title, s.season)) tags.add(t)
    }
  }
  for (const e of episodes) {
    if (e?.title && e.season != null && e.episode != null) {
      for (const t of getAllEpisodeCacheTags(e.title, e.season, e.episode)) tags.add(t)
    }
  }

  for (const tag of tags) {
    revalidateTag(tag, 'max')
  }

  // Over-invalidation observability: structured so SigNoz can alert when the
  // unique-tag count (or any entity bucket) spikes far beyond what a normal sync
  // touches. "completed" entities are not a guaranteed field-level diff (the
  // services emit completed whenever the smart-upsert ran), so this is the place
  // to watch if invalidation starts firing too broadly.
  log.info(
    {
      entities: {
        movies: movies.length,
        shows: shows.length,
        seasons: seasons.length,
        episodes: episodes.length,
      },
      uniqueTags: tags.size,
    },
    'Post-sync media cache revalidation completed'
  )

  return new Response(
    JSON.stringify({
      revalidated: true,
      entities: {
        movies: movies.length,
        shows: shows.length,
        seasons: seasons.length,
        episodes: episodes.length,
      },
      uniqueTags: tags.size,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  )
}

/**
 * Handle sync operation request
 * @param {Request} request - The request object
 * @param {string} webhookId - The webhook ID from the request
 * @returns {Promise<Response>} - Response to the sync request
 */
async function handleSyncOperation(request, webhookId) {
  // If a sync is already running, return the stream URL so the client can subscribe
  if (activeSyncOperation) {
    return new Response(
      JSON.stringify({
        alreadyRunning: true,
        streamUrl: '/api/authenticated/admin/sync-stream',
      }),
      {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  // Read sync options from the request body (Force Refresh checkbox in the
  // SyncMediaPopup posts { forceSync: boolean }). Empty/malformed body → defaults.
  let forceSync = false
  try {
    const body = await request.clone().json()
    forceSync = Boolean(body?.forceSync)
  } catch {
    // No JSON body or invalid — leave forceSync at default (false)
  }

  startTime = new Date().toISOString()
  startSnapshotTracking()

  // Fire and forget — response is delivered via SSE stream
  activeSyncOperation = handleSync(webhookId, request, { forceSync })
  activeSyncOperation
    .then(() => {
      syncSubscribers.forEach((s) => s.resolve())
    })
    .catch((err) => {
      console.error('Sync operation failed:', err)
      syncSubscribers.forEach((s) => s.reject(err))
    })
    .finally(() => {
      activeSyncOperation = null
      syncSubscribers = []
      stopSnapshotTracking()
    })

  return new Response(
    JSON.stringify({
      started: true,
      startTime,
      streamUrl: '/api/authenticated/admin/sync-stream',
    }),
    {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    }
  )
}

export async function POST(request, props) {
  const params = await props.params
  const authResult = await isAdminOrWebhook(request)
  if (authResult instanceof Response) {
    return authResult
  }
  
  const webhookId = request.headers.get('X-Webhook-ID') ?? null
  const serverId = request.webhookServerId // This comes from enhanced webhookId validation

  const slugs = params.admin
  
  // Route the request to the appropriate handler based on the path
  if (slugs.length >= 2 && slugs[0] === 'admin') {
    // Handle system status notification
    if (slugs[1] === 'system-status-notification') {
      return handleSystemStatusNotification(request, webhookId, serverId);
    }

    // Handle post-sync media cache revalidation (fired internally by the sync)
    if (slugs[1] === 'revalidate-media') {
      return handleRevalidateMedia(request);
    }

    // Handle sync operation
    if (slugs.includes('sync')) {
      return handleSyncOperation(request, webhookId);
    }
  }

  // Unsupported operation
  return new Response(JSON.stringify({ error: 'Unsupported operation' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Fire the post-sync cache revalidation by POSTing the changed entities to the
 * /admin/revalidate-media route. That route runs in its own request scope — the
 * only place revalidateTag actually commits for this fire-and-forget sync.
 *
 * Self-authenticates: forwards the incoming webhook id when present (webhook-
 * triggered sync), otherwise falls back to WEBHOOK_ID from env (admin-UI-
 * triggered sync, which carries a session, not a webhook id). Never throws — the
 * caller wraps it, and a revalidation miss must never fail a sync.
 *
 * @param {Request} request - the original sync request (used for the self origin)
 * @param {string|null} webhookId - incoming webhook id, if any
 * @param {Object|undefined} changedMedia - { movies, shows, seasons, episodes }
 */
async function triggerPostSyncRevalidation(request, webhookId, changedMedia) {
  if (!changedMedia) {
    console.log('[Cache SWR] No changedMedia on sync result — skipping post-sync revalidation')
    return
  }

  const totalChanged =
    (changedMedia.movies?.length || 0) +
    (changedMedia.shows?.length || 0) +
    (changedMedia.seasons?.length || 0) +
    (changedMedia.episodes?.length || 0)

  if (totalChanged === 0) {
    console.log('[Cache SWR] Nothing changed this sync — skipping post-sync revalidation')
    return
  }

  const internalWebhookId = webhookId || process.env.WEBHOOK_ID
  if (!internalWebhookId) {
    console.error('[Cache SWR] No webhook id available for internal revalidation call — skipping')
    return
  }

  // Target loopback, NOT request.url's origin. The sync is usually webhook-
  // triggered, so request.url carries the EXTERNAL host, which the container
  // cannot reach from inside (hairpin NAT, and TLS terminates at the proxy) —
  // that produced a "fetch failed" and the revalidation silently never ran.
  // The standalone server always listens on 127.0.0.1:PORT. Prefer PORT (set in
  // the Docker image), fall back to the incoming request's port (covers
  // `next dev -p 3232`), then the Next default.
  const port = process.env.PORT || new URL(request.url).port || '3000'
  const revalidateUrl = `http://127.0.0.1:${port}/api/authenticated/admin/revalidate-media`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetch(revalidateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-ID': internalWebhookId,
      },
      body: JSON.stringify(changedMedia),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (!response.ok) {
      console.error(`[Cache SWR] revalidate-media responded ${response.status}`)
    } else {
      console.log(`[Cache SWR] Post-sync revalidation triggered for ${totalChanged} changed entities`)
    }
  } catch (fetchError) {
    clearTimeout(timeoutId)
    console.error(`[Cache SWR] revalidate-media request failed: ${fetchError.message}`)
  }
}

/**
 * Handles sync operation with improved error handling.
 * @param {string|null} webhookId - Webhook ID
 * @param {Request} request - Request object
 * @returns {Promise<Object>} Sync results
 */
async function handleSync(webhookId, request, syncOptions = {}) {
  // Add a flag to track whether this sync operation is still in progress
  let syncInProgress = true;
  const syncStartTime = new Date();
  const forceSync = Boolean(syncOptions.forceSync);
  
  try {
    const headers = {}
    if (webhookId) headers['X-Webhook-ID'] = webhookId

    // Get file server(s) data directly (no internal HTTP call)
    const { fileServers, errors } = await getFileServerData({skipAuth: true});

    // Initialize field-level availability maps
    const fieldAvailability = {
      movies: {},
      tv: {},
    }

    // Build availability maps per server
    for (const [serverId, fileServer] of Object.entries(fileServers)) {
      // For Movies - add null check to avoid errors on undefined
      if (fileServer.movies) {
        for (const [movieTitle, movieData] of Object.entries(fileServer.movies)) {
          if (!fieldAvailability.movies[movieTitle]) {
            fieldAvailability.movies[movieTitle] = {}
          }

          collectFieldAvailability(movieData, '', serverId, fieldAvailability.movies[movieTitle])
        }
      }

      // For TV Shows - add null check to avoid errors on undefined
      if (fileServer.tv) {
        for (const [showTitle, showData] of Object.entries(fileServer.tv)) {
          if (!fieldAvailability.tv[showTitle]) {
            fieldAvailability.tv[showTitle] = {}
          }

          collectFieldAvailability(showData, '', serverId, fieldAvailability.tv[showTitle])
        }
      }
    }

    const importSettings = await getFileServerImportSettings()
    console.log('Import Settings:', importSettings)

    // Parse URL parameters for sync architecture options
    const url = new URL(request.url);
    const useNewArchitecture = url.searchParams.get('useNewArchitecture') === 'true';
    const forceOldArchitecture = url.searchParams.get('forceOldArchitecture') === 'true';
    
    // Log architecture choice for debugging
    if (useNewArchitecture) {
      console.log('🆕 Admin API: Using NEW sync architecture (query parameter override)');
    } else if (forceOldArchitecture) {
      console.log('🔄 Admin API: Forcing OLD sync architecture (query parameter override)');
    }

    // Ensure MongoDB indexes exist before the first bulk write.
    // createDatabaseAdapter is idempotent — it initialises the singleton adapter
    // and calls createIndexes() on all four collections (Movies, TVShows, Seasons,
    // Episodes) if they haven't been created yet in this process lifetime.
    const client = await clientPromise
    await createDatabaseAdapter(client)

    // Authoritative-pass gate for field-absence cleanup. getFileServerData sets
    // `errors` (an array) only when a server failed to respond; undefined means
    // every configured server was fetched cleanly. Field-absence cleanup must
    // never run on a partial pass, or a transient outage would be read as a
    // deletion and wipe good data.
    const allEnabledServersProbed = !errors && Object.keys(fileServers || {}).length > 0

    // Perform the actual sync with architecture options
    const result = await syncAllServers(fileServers, fieldAvailability, {
      useNewArchitecture,
      forceOldArchitecture,
      forceSync,
      allEnabledServersProbed,
    })
    
    // Mark sync as complete to prevent logging errors after completion
    syncInProgress = false;
    
    // Calculate sync duration
    const syncEndTime = new Date();
    const durationMs = syncEndTime.getTime() - syncStartTime.getTime();
    const durationMinutes = Math.round(durationMs / 60000 * 10) / 10; // Round to 1 decimal place
    
    // Create admin-only sync completion notification
    try {
      // Determine server name - use first file server or default
      const serverNames = Object.keys(fileServers);
      const serverName = serverNames.length > 0 ? serverNames[0] : 'Unknown Server';
      
      // Extract sync statistics from the result
      const stats = {
        moviesAdded: result.moviesAdded || 0,
        episodesAdded: result.episodesAdded || 0,
        duration: `${durationMinutes} minutes`
      };
      
      console.log(`Creating sync completion notification for admins. Server: ${serverName}, Stats:`, stats);
      
      await NotificationManager.createSyncCompleteForAdmins(serverName, stats);
      
      console.log('Admin sync completion notification created successfully');
    } catch (notificationError) {
      console.error('Failed to create sync completion notification:', notificationError);
      // Don't fail the sync operation if notification creation fails
    }

    // Bust the media-page caches for everything that changed this run. This MUST
    // happen via a fresh request (not inline): the sync is fire-and-forget, so an
    // inline revalidateTag here would no-op (the 202 already flushed this request's
    // revalidation window). We POST the changed entities to /admin/revalidate-media,
    // which runs in its own request scope where revalidateTag commits. Wrapped so a
    // revalidation failure never fails the sync.
    try {
      await triggerPostSyncRevalidation(request, webhookId, result?.changedMedia)
    } catch (revalidationError) {
      console.error('Post-sync cache revalidation failed:', revalidationError.message)
    }

    return result;
  } catch (error) {
    console.error('Sync operation failed:', error)
    // Update the flag to indicate sync is no longer in progress
    syncInProgress = false;
    throw error;
  } finally {
    // Ensure the flag is always updated in case of any errors
    syncInProgress = false;
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

      // Update to include flat database collections instead of old structure
      const collections = ['FlatMovies', 'FlatTVShows', 'FlatSeasons', 'FlatEpisodes']
      
      // Track results for detailed response
      const results = {}
      
      for (const collectionName of collections) {
        const collection = db.collection(collectionName)
        const deleteResult = await collection.deleteMany({})
        results[collectionName] = deleteResult.deletedCount
        console.log(`Cleared ${deleteResult.deletedCount} documents from ${collectionName}`)
      }
      
      console.log('Cleared all documents from flat database collections')
      return new Response(JSON.stringify({ 
        message: 'Cleared all documents from flat database collections',
        details: results 
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      console.error('Error clearing flat database collections:', error)
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }
  
  return new Response(JSON.stringify({ error: 'Invalid operation' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  })
}
