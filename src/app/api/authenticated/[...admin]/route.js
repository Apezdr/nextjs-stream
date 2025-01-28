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
  syncTVThumbnails,
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
import { getAllServers } from '@src/utils/config'
import { exec } from 'child_process'
import clientPromise from '@src/lib/mongodb'
import { syncMovieDataAllServers, syncTVDataAllServers } from '@src/utils/sync_utils'
import { getCpuUsage, getMemoryTotal, getMemoryUsage, getMemoryUsed } from '@src/utils/monitor_server_load'
import { fetchProcesses } from '@src/utils/server_track_processes'

/**
 * Extracts all server endpoints from the configuration.
 * @returns {Array<Object>} Array of server endpoints with relevant URLs.
 */
function extractServerEndpoints() {
  const servers = getAllServers();
  
  return servers;
}

/**
 * Fetches the latest image digest from Docker Hub for a given repository.
 * @param {string} repo - The Docker repository name (e.g., "membersolo/nextjs-stream")
 * @returns {string} - The image digest.
 */
const getDockerHubDigest = async (repo) => {
  const url = `https://hub.docker.com/v2/repositories/${repo}/tags/latest/`;
  
  try {
    const response = await axios.get(url);
    const data = response.data;

    if (!data || data.length === 0) {
      throw new Error(`No image information found for ${repo}`);
    }

    // Assuming the first image is the one we need (usually for amd64)
    const digest = data.digest;

    if (!digest) {
      throw new Error(`Digest not found for ${repo}`);
    }

    return { digest, last_updated: data.last_updated };
  } catch (error) {
    throw new Error(`Failed to fetch Docker Hub digest for ${repo}: ${error.message}`);
  }
};

/**
 * Fetches the current image digest from the server for a given repository.
 * @param {string} repo - The Docker repository name (e.g., "membersolo/nextjs-stream")
 * @returns {Promise<string>} - The image digest.
 */
const getServerImageDigest = (repo) => {
  return new Promise((resolve, reject) => {
    // Correct the Docker command: Use double quotes around the --format option
    const command = `docker inspect --format="{{index .RepoDigests 0}}" ${repo}:latest`;

    exec(command, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(`Failed to fetch server image digest for ${repo}: ${stderr || error.message}`));
      }

      const fullDigest = stdout.trim();

      if (!fullDigest) {
        return reject(new Error(`No digest found for image ${repo}:latest`));
      }

      // Extract the digest part
      const digestMatch = fullDigest.match(/@(.+)/);
      if (!digestMatch || !digestMatch[1]) {
        return reject(new Error(`Invalid digest format for image ${repo}:latest`));
      }

      resolve(digestMatch[1]);
    });
  });
};

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
          ];      
          // Fetch digests from Docker Hub and Server
          const results = await Promise.all(
            repos.map(async (repo) => {
              let dockerHubDigest = null;
              let serverDigest = null;
              let errors = [];
              
              try {
                dockerHubDigest = await getDockerHubDigest(repo);
              } catch (err) {
                console.error(`Error fetching Docker Hub digest for ${repo}:`, err);
                errors.push(`Docker Hub: ${err.message}`);
              }

              try {
                serverDigest = await getServerImageDigest(repo);
              } catch (err) {
                console.error(`Error fetching Server digest for ${repo}:`, err);
                errors.push(`Server: ${err.message}`);
              }

              const isUpToDate = dockerHubDigest?.digest === serverDigest;
              const returnData = { 
                repo,
                dockerHubDigest: dockerHubDigest || null, 
                serverDigest: serverDigest || null, 
                isUpToDate,
                last_updated: dockerHubDigest?.last_updated || null
              };

              if (errors.length > 0) {
                returnData.errors = errors;
              }

              return returnData;
            })
          );
          responseData = results;
        }
        break

      case 'server-load':
        {
          const cpu = getCpuUsage(); // e.g., 2.25
          const memoryUsage = getMemoryUsage(); // e.g., 10.24
          const memoryUsed = getMemoryUsed(); // e.g., 6.40
          const memoryTotal = getMemoryTotal(); // e.g., 62.80
          responseData = {
            cpu,
            memoryUsed,
            memoryTotal,
            memoryUsage
          };
        }
        break

      case 'server-processes':
        {
          const processes = await fetchProcesses()
          responseData = processes
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

// POST method for handling the sync operation
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

      // Indicate the start time of the sync operation
      // This will be used to inform subscribers about the sync operation
      startTime = new Date().toISOString()
      // Create a new sync operation promise
      activeSyncOperation = handleSync(webhookId, request)

      try {
        const result = await activeSyncOperation
        
        // Notify all subscribers of the result
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
        // Notify all subscribers of the error
        syncSubscribers.forEach(subscriber => {
          subscriber.reject(error)
        })
        throw error
      } finally {
        // Clean up
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

  // Handle other POST operations or return an error for unsupported operations
  return new Response(JSON.stringify({ error: 'Unsupported operation' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Performs a multi-server sync operation, fetching data from all configured servers, identifying missing media, and syncing various metadata and content.
 *
 * @param {string|null} webhookId - The ID of the webhook, if any, that triggered the sync operation.
 * @param {Request} request - The incoming HTTP request object.
 * @returns {Promise<{ missingMedia: object, missingMp4: object }>} - An object containing information about missing media and MP4 files.
 */
async function handleSync(webhookId, request) {
  try {
    // Fetch data from all configured servers
    const headers = {}
    if (webhookId) headers['X-Webhook-ID'] = webhookId
    if (request.headers.get('cookie')) headers['cookie'] = request.headers.get('cookie')

    const response = await axios.get(buildURL('/api/authenticated/list'), { headers })
    const { fileServers, currentDB, errors } = await response.data

    // Initialize field-level availability maps
    const fieldAvailability = {
      movies: {},
      tv: {},
    };

    // Build availability maps per server
    for (const [serverId, fileServer] of Object.entries(fileServers)) {
      // For Movies
      for (const [movieTitle, movieData] of Object.entries(fileServer.movies || {})) {
        if (!fieldAvailability.movies[movieTitle]) {
          fieldAvailability.movies[movieTitle] = {};
        }

        // Collect availability for the entire movie data
        collectFieldAvailability(movieData, '', serverId, fieldAvailability.movies[movieTitle]);
      }

      // For TV Shows
      for (const [showTitle, showData] of Object.entries(fileServer.tv || {})) {
        if (!fieldAvailability.tv[showTitle]) {
          fieldAvailability.tv[showTitle] = {};
        }

        // Collect availability for the entire show data
        collectFieldAvailability(showData, '', serverId, fieldAvailability.tv[showTitle]);
      }
    }

    const startTime = Date.now()
    console.info(
      chalk.bold.dim(`⋄⋄ Starting Multi-Server Sync ⋄⋄ [${new Date(startTime).toISOString()}]`)
    )

    const importSettings = await getFileServerImportSettings()
    console.log('Import Settings:', importSettings)

    const results = {
      missingMedia: {},
      missingMp4: {},
      errors: errors || [],
    }

    let contentAddedToDB = {
      movies: [],
      tv: [],
    }

    // Then do your incremental sync for Movies
    const client = await clientPromise
    const startMovies = Date.now()
    console.info(chalk.bold.cyan(`\nProcessing movies batch [${new Date(startMovies).toISOString()}]`))
    await syncMovieDataAllServers(client, currentDB, fileServers)
    const endMovies = Date.now()
    const durationMovies = (endMovies - startMovies) / 1000
    console.info(chalk.bold.cyan(`Finished Processing movies batch [${new Date(endMovies).toISOString()}] (Runtime: ${durationMovies.toFixed(2)}s)`))

    const startTV = Date.now()
    console.info(chalk.bold.magenta(`\nProcessing TV batch [${new Date(startTV).toISOString()}]`))
    await syncTVDataAllServers(client, currentDB, fileServers)
    const endTV = Date.now()
    const durationTV = (endTV - startTV) / 1000
    console.info(chalk.bold.magenta(`Finished Processing TV batch [${new Date(endTV).toISOString()}] (Runtime: ${durationTV.toFixed(2)}s)`))
    // Process each server sequentially to avoid overwhelming the system
    for (const [serverId, fileServer] of Object.entries(fileServers)) {
      console.info(chalk.bold.cyan(`\nProcessing server: ${serverId}`))

      try {
        const serverConfig = {
          id: serverId,
          ...fileServer.config,
        }

        // Identify missing media for this server
        // This runs against potentially stale data from the server since it only pulls the DB data once
        // use contentAddedToDB to track new content added to the DB during the sync process
        // may need granular tracking for each episode updated instead of just the whole show
        const { missingMedia, missingMp4 } = await identifyMissingMedia(fileServer, currentDB)
        results.missingMedia[serverId] = missingMedia
        results.missingMp4[serverId] = missingMp4

        // Perform sync operations with server-specific configuration
        await syncMissingMedia(missingMedia, fileServer, serverConfig, contentAddedToDB)
        //await syncMetadata(currentDB, fileServer, serverConfig, fieldAvailability)
        //await syncCaptions(currentDB, fileServer, serverConfig, fieldAvailability)
        await syncChapters(currentDB, fileServer, serverConfig, fieldAvailability)
        await syncVideoURL(currentDB, fileServer, serverConfig, fieldAvailability)
        await syncLogos(currentDB, fileServer, serverConfig, fieldAvailability)
        //await syncVideoInfo(currentDB, fileServer, serverConfig, fieldAvailability)
        await syncTVThumbnails(currentDB, fileServer, serverConfig, fieldAvailability)
        await syncPosterURLs(currentDB, fileServer, serverConfig, fieldAvailability)
        await syncBackdrop(currentDB, fileServer, serverConfig, fieldAvailability)
        await syncBlurhash(currentDB, fileServer, serverConfig, fieldAvailability)
      } catch (error) {
        console.error(`Error processing server ${serverId}:`, error)
        results.errors.push({
          serverId,
          error: error.message,
          phase: 'sync',
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
    // Return time needed to run the sync operation
    results.duration = duration

    return results
  } catch (error) {
    console.error('Sync operation failed:', error)
    throw error
  }
}

/**
 * Recursively traverses the media data to collect field availability.
 * @param {Object} mediaData - The media data object.
 * @param {string} currentPath - The current field path.
 * @param {string} serverId - The ID of the server providing the data.
 * @param {Object} availabilityMap - The map to populate with field availability.
 */
function collectFieldAvailability(mediaData, currentPath, serverId, availabilityMap) {
  for (const key in mediaData) {
    if (!mediaData.hasOwnProperty(key)) continue;

    const value = mediaData[key];
    let newPath = currentPath ? `${currentPath}.${key}` : key;

    if (Array.isArray(value)) {
      if (key === 'fileNames') {
        // Since fileNames is an array of strings, you might not need to track each filename individually.
        // Instead, consider if you need to include this field at all.
        continue;
      } else if (key === 'audio' || key === 'video') {
        // Handle arrays of objects like audio and video tracks
        value.forEach((item, index) => {
          const trackType = item.codec || index;
          const arrayPath = `${newPath}.${trackType}`;
          collectFieldAvailability(item, arrayPath, serverId, availabilityMap);
        });
      } else {
        // For other arrays, use identifiable properties if available
        value.forEach((item, index) => {
          if (item && typeof item === 'object') {
            let identifier = item.name || item.id || index;
            const arrayPath = `${newPath}.${identifier}`;
            collectFieldAvailability(item, arrayPath, serverId, availabilityMap);
          } else {
            // For primitive array items, you can skip or include them based on your needs
            // Skipping here as they may not be meaningful
          }
        });
      }
    } else if (typeof value === 'object' && value !== null) {
      collectFieldAvailability(value, newPath, serverId, availabilityMap);
    } else {
      // Primitive value
      if (!availabilityMap[newPath]) {
        availabilityMap[newPath] = [];
      }
      if (!availabilityMap[newPath].includes(serverId)) {
        availabilityMap[newPath].push(serverId);
      }
    }
  }
}


// handle delete requests
// Require the user to be an admin to delete content
// If the user is an admin, delete the content from the database
// Use this for wiping the database for movie and tv shows
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
        // Delete all documents from collections while preserving the collections and indexes
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