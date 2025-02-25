import { createFullUrl, filterLockedFields, isSourceMatchingServer, isCurrentServerHighestPriorityForField, MediaType, findEpisodeFileName } from './utils'
import { updateEpisodeInDatabase, updateMediaInDatabase } from './database'
import clientPromise from '@src/lib/mongodb'
import chalk from 'chalk'
import { isEqual } from 'lodash'
import { fetchMetadataMultiServer } from '@src/utils/admin_utils'
import { getCacheBatch } from '@src/lib/cache'
import pLimit from 'p-limit'

const CONCURRENCY_LIMIT = 200
const limit = pLimit(CONCURRENCY_LIMIT)

/**
 * Determines the best metadata based on priority and last_updated.
 * @param {Array} metadataArray - Array of metadata objects with priority
 * @returns {Object|null} Best metadata or null
 */
function determineBestMetadata(metadataArray) {
  return metadataArray.reduce((best, current) => {
    if (!best) return current
    if (current.priority < best.priority) return current
    if (
      current.priority === best.priority &&
      new Date(current.metadata.last_updated) > new Date(best.metadata.last_updated)
    ) {
      return current
    }
    return best
  }, null) || null
}

/**
 * Gathers metadata for a movie from all servers.
 * @param {Object} movie - Movie object
 * @param {Object} fileServers - File servers data
 * @returns {Object|null} Best metadata or null
 */
export async function gatherMovieMetadataForAllServers(movie, fileServers) {
  // 1) Build a list of servers that actually have a metadata URL for this movie
  const movieMetadataEntries = Object.entries(fileServers)
    .map(([serverId, fileServer]) => {
      const fileServerMovieData = fileServer.movies?.[movie.title];
      if (!fileServerMovieData) return null;

      const metadataURL = fileServerMovieData.urls?.metadata;
      if (!metadataURL) return null;

      // Prepare a "batch entry" similar to the TV logic
      const serverConfig = { id: serverId, ...fileServer.config };
      const cacheKey = `${serverConfig.id}:file:${metadataURL}`;

      return { serverId, serverConfig, metadataURL, cacheKey };
    })
    .filter(Boolean);

  // If no servers have metadata for this movie, return null
  if (movieMetadataEntries.length === 0) {
    return null;
  }

  // 2) Retrieve any existing cache entries in batch
  const movieCacheKeys = movieMetadataEntries.map((entry) => entry.cacheKey);
  const cachedMovieEntries = await getCacheBatch(movieCacheKeys);

  // 3) Prepare concurrency-limited fetch promises
  const fetchPromises = movieMetadataEntries.map((entry) => {
    const { serverId, serverConfig, metadataURL, cacheKey } = entry;
    const cachedEntry = cachedMovieEntries[cacheKey];

    // Build conditional headers
    const headers = {};
    if (cachedEntry) {
      if (cachedEntry.etag) {
        headers['If-None-Match'] = cachedEntry.etag;
      }
      if (cachedEntry.lastModified) {
        headers['If-Modified-Since'] = cachedEntry.lastModified;
      }
    }

    // Return an object that includes everything we need to do the actual fetch
    return {
      serverId,
      serverConfig,
      metadataURL,
      headers,
      cacheKey,
    };
  });

  // Execute all fetch operations concurrently (with optional p-limit)
  const results = await Promise.all(
    fetchPromises.map((entry) =>
      fetchMetadataMultiServer(
        entry.serverId,
        entry.metadataURL,
        'file',
        'movie',
        movie.title,
        entry.headers,
        entry.cacheKey
      )
    )
  );

  // 4) Pair up each result with its server priority so we can pick the "best"
  const validMetadataArray = results
    .map((metadata, index) => {
      if (!metadata) return null;
      const { priority } = fetchPromises[index].serverConfig;
      return {
        metadata,
        priority,
      };
    })
    .filter(Boolean);

  // 5) Determine the best metadata
  // (Same logic as used in TV code: pick the lowest priority, then newest last_updated.)
  const bestMetadata = determineBestMetadata(validMetadataArray);

  if (bestMetadata && bestMetadata.release_date && typeof bestMetadata.release_date === 'string') {
    bestMetadata.release_date = new Date(bestMetadata.release_date)
  }

  return bestMetadata;
}

/**
 * Finalizes movie metadata in the database.
 * @param {Object} client - Database client
 * @param {Object} movie - Movie object
 * @param {Object} bestMetadata - Best metadata
 * @returns {Promise<void>}
 */
export async function finalizeMovieMetadata(client, movie, bestMetadata, fieldAvailability) {
  if (!bestMetadata) return

  // Force update if metadata or source is missing
  const shouldForceUpdate = !movie.metadata || !movie.metadataSource

  // Compare last_updated
  const existingMetadataLastUpdated = new Date(movie.metadata?.last_updated || '1970-01-01')
  const newMetadataLastUpdated = new Date(bestMetadata.last_updated || '1970-01-01')

  // Check if current server has highest priority for metadata
  const isHighestPriorityForMetadata = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    MediaType.MOVIE,
    movie.title,
    'metadata',
    { id: bestMetadata.metadataSource }
  )

  if (shouldForceUpdate || (newMetadataLastUpdated > existingMetadataLastUpdated && isHighestPriorityForMetadata)) {
    const updateData = {
      metadata: bestMetadata,
      metadataSource: bestMetadata.metadataSource
    }

    // Remove metadataSource from the updateData
    delete updateData.metadata?.metadataSource

    const filteredUpdateData = filterLockedFields(movie, updateData)
    if (Object.keys(filteredUpdateData).length === 0) {
      console.log(`All metadata fields locked for movie "${movie.title}". Skipping update.`)
      return
    }

    console.log(`Movie: Updating metadata for "${movie.title}"...`)
    const preparedUpdateData = { $set: filteredUpdateData }
    await updateMediaInDatabase(client, MediaType.MOVIE, movie.title, preparedUpdateData)
  }
}

/**
 * Gathers TV metadata from all servers.
 * @param {Object} show - Show object
 * @param {Object} fileServers - File servers data
 * @returns {Promise<Object>} Aggregated metadata
 */
export async function gatherTvMetadataForAllServers(show, fileServers) {
  const aggregatedData = {
    showMetadata: null,
    seasons: {},
  }

  // Gather Show-Level Metadata Concurrently
  const showMetadataEntries = Object.entries(fileServers).map(([serverId, fileServer]) => {
    if (!fileServer.tv?.[show.title]) return null
    const serverConfig = { id: serverId, ...fileServer.config }
    const metadataURL = fileServer.tv[show.title]?.metadata
    if (!metadataURL) return null

    const cacheKey = `${serverConfig.id}:file:${metadataURL}`
    return { serverId, serverConfig, metadataURL, cacheKey }
  }).filter(Boolean)

  const showCacheKeys = showMetadataEntries.map(entry => entry.cacheKey)
  const cachedShowEntries = await getCacheBatch(showCacheKeys)

  const fetchShowPromises = showMetadataEntries.map((entry) => {
    const { serverId, serverConfig, metadataURL, cacheKey } = entry
    const cachedEntry = cachedShowEntries[cacheKey]

    const headers = {}
    if (cachedEntry) {
      if (cachedEntry.etag) {
        headers['If-None-Match'] = cachedEntry.etag
      }
      if (cachedEntry.lastModified) {
        headers['If-Modified-Since'] = cachedEntry.lastModified
      }
    }

    return {
      serverId,
      serverConfig,
      metadataURL,
      headers,
      cacheKey,
    }
  })

  // Execute all fetch operations concurrently
  const fetchShowData = await Promise.all(
    fetchShowPromises.map(entry => fetchMetadataMultiServer(
        entry.serverId,
        entry.metadataURL,
        'file',
        'tv',
        show.title,
        entry.headers,
        entry.cacheKey
      ))
  )

  // Filter out null responses and determine the best metadata
  const validShowMetadata = fetchShowData
    .map((data, index) => {
      if (!data) return null
      return { metadata: data, ...showMetadataEntries[index].serverConfig }
    })
    .filter(Boolean)

  const bestShowMetadata = determineBestMetadata(validShowMetadata)
  aggregatedData.showMetadata = bestShowMetadata.metadata
  aggregatedData.metadataSource = bestShowMetadata.id

  // Gather Season and Episode-Level Metadata Concurrently
  const seasonPromises = show.seasons.map(async (season) => {
    const { seasonNumber } = season

    // Gather Season Metadata Concurrently
    const seasonMetadataEntries = Object.entries(fileServers).map(([serverId, fileServer]) => {
      const serverConfig = { id: serverId, ...fileServer.config }
      const fileServerShowData = fileServer.tv?.[show.title]
      if (!fileServerShowData) return null
      const fileServerShowMetadataURL = fileServerShowData.metadata
      if (!fileServerShowMetadataURL) return null

      const metadataURL = fileServerShowMetadataURL
      const cacheKey = `${serverConfig.id}:file:${metadataURL}`
      return { serverId, serverConfig, metadataURL, cacheKey }
    }).filter(Boolean)

    if (seasonMetadataEntries.length === 0) return

    const seasonCacheKeys = seasonMetadataEntries.map(entry => entry.cacheKey)
    const cachedSeasonEntries = await getCacheBatch(seasonCacheKeys)

    const fetchSeasonPromises = seasonMetadataEntries.map((entry) => {
      const { serverId, serverConfig, metadataURL, cacheKey } = entry
      const cachedEntry = cachedSeasonEntries[cacheKey]

      const headers = {}
      if (cachedEntry) {
        if (cachedEntry.etag) {
          headers['If-None-Match'] = cachedEntry.etag
        }
        if (cachedEntry.lastModified) {
          headers['If-Modified-Since'] = cachedEntry.lastModified
        }
      }

      return {
        serverId,
        serverConfig,
        metadataURL,
        headers,
        cacheKey,
      }
    })

    const fetchSeasonData = await Promise.all(
      fetchSeasonPromises.map(entry => 
        limit(() => fetchMetadataMultiServer(
          entry.serverId,
          entry.metadataURL,
          'file',
          'tv',
          show.title,
          entry.headers,
          entry.cacheKey
        ))
      )
    )

    const validSeasonMetadata = fetchSeasonData
      .map((data, index) => {
        if (!data) return null
        return { metadata: data, ...seasonMetadataEntries[index].serverConfig }
      })
      .filter(Boolean)

    const bestSeasonMetadata = determineBestMetadata(validSeasonMetadata)

    // Gather Episode Metadata Concurrently
    const episodePromises = season.episodes.map(async (episode) => {
      const { episodeNumber } = episode

      const episodeMetadataEntries = Object.entries(fileServers).map(([serverId, fileServer]) => {
        const serverConfig = { id: serverId, ...fileServer.config }
        const fileServerShowData = fileServer.tv?.[show.title]
        if (!fileServerShowData) return null

        const seasonKey = `Season ${seasonNumber}`
        const fsSeasonData = fileServerShowData.seasons?.[seasonKey]
        if (!fsSeasonData?.episodes) return null

        const episodeFileName = findEpisodeFileName(
          Object.keys(fsSeasonData.episodes),
          seasonNumber,
          episodeNumber
        )
        if (!episodeFileName) return null

        const episodeData = fsSeasonData.episodes[episodeFileName]
        if (!episodeData?.metadata) return null

        const metadataURL = episodeData.metadata
        const cacheKey = `${serverConfig.id}:file:${metadataURL}`
        return { serverId, serverConfig, metadataURL, cacheKey }
      }).filter(Boolean)

      if (episodeMetadataEntries.length === 0) return

      const episodeCacheKeys = episodeMetadataEntries.map(entry => entry.cacheKey)
      const cachedEpisodeEntries = await getCacheBatch(episodeCacheKeys)

      const fetchEpisodePromises = episodeMetadataEntries.map((entry) => {
        const { serverId, serverConfig, metadataURL, cacheKey } = entry
        const cachedEntry = cachedEpisodeEntries[cacheKey]

        const headers = {}
        if (cachedEntry) {
          if (cachedEntry.etag) {
            headers['If-None-Match'] = cachedEntry.etag
          }
          if (cachedEntry.lastModified) {
            headers['If-Modified-Since'] = cachedEntry.lastModified
          }
        }

        return {
          serverId,
          serverConfig,
          metadataURL,
          headers,
          cacheKey,
        }
      })

      const fetchEpisodeData = await Promise.all(
        fetchEpisodePromises.map(entry => 
          limit(() => fetchMetadataMultiServer(
            entry.serverId,
            entry.metadataURL,
            'file',
            'tv',
            show.title,
            entry.headers,
            entry.cacheKey
          ))
        )
      )

      const validEpisodeMetadata = fetchEpisodeData
        .map((data, index) => {
          if (!data) return null
          return { metadata: data, ...episodeMetadataEntries[index].serverConfig }
        })
        .filter(Boolean)

      const bestEpisodeMetadata = determineBestMetadata(validEpisodeMetadata)

      if (bestSeasonMetadata || bestEpisodeMetadata) {
        aggregatedData.seasons[seasonNumber] = aggregatedData.seasons[seasonNumber] || {
          seasonMetadata: null,
          episodes: [{}],
        }

        if (bestSeasonMetadata.metadata) {
          aggregatedData.seasons[seasonNumber].seasonMetadata = { ...bestSeasonMetadata.metadata, metadataSource: bestSeasonMetadata.id }
          aggregatedData.seasons[seasonNumber] = { ...aggregatedData.seasons[seasonNumber], metadataSource: bestSeasonMetadata.id }
        }

        if (bestEpisodeMetadata?.metadata) {
          // Initialize episodes array if it doesn't exist
          if (!aggregatedData.seasons[seasonNumber].episodes) {
            aggregatedData.seasons[seasonNumber].episodes = [{}]
          }

          // Find existing episode in the array
          const existingEpisodeIndex = aggregatedData.seasons[seasonNumber].episodes.findIndex(
            ep => ep.episode_number === Number(episodeNumber)
          )

          const newEpisodeMetadata = {
            ...bestEpisodeMetadata.metadata,
            episode_number: Number(episodeNumber),
            season_number: Number(seasonNumber),
            metadataSource: bestEpisodeMetadata.id
          }

          // Check if we should update based on last_updated timestamp
          if (existingEpisodeIndex !== -1) {
            const existingEpisode = aggregatedData.seasons[seasonNumber].episodes[existingEpisodeIndex]
            const existingLastUpdated = new Date(existingEpisode.last_updated || '1970-01-01')
            const newLastUpdated = new Date(newEpisodeMetadata.last_updated || '1970-01-01')

            if (newLastUpdated > existingLastUpdated) {
              // Update existing episode
              aggregatedData.seasons[seasonNumber].episodes[existingEpisodeIndex] = newEpisodeMetadata
            }
          } else {
            // Remove any empty episodes
            aggregatedData.seasons[seasonNumber].episodes = aggregatedData.seasons[seasonNumber].episodes.filter((t) => t.id)
            // Add new episode
            aggregatedData.seasons[seasonNumber].episodes.push(newEpisodeMetadata)
          }

          // Sort episodes by episode number
          aggregatedData.seasons[seasonNumber].episodes.sort((a, b) => a.episode_number - b.episode_number)
        }
      }
    })

    await Promise.all(episodePromises)
  })

  await Promise.all(seasonPromises)

  return aggregatedData
}

/**
 * Finalizes TV metadata in the database.
 * @param {Object} client - Database client
 * @param {Object} show - Show object
 * @param {Object} aggregatedData - Aggregated metadata
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<void>}
 */
export async function finalizeTvMetadata(client, show, aggregatedData, fieldAvailability) {
  if (!aggregatedData?.showMetadata) return

  // Show-level metadata
  const existingMetadataLastUpdated = new Date(show.metadata?.last_updated || '1970-01-01')
  const newMetadataLastUpdated = new Date(aggregatedData.showMetadata.last_updated || '1970-01-01')
  
  const isHighestPriorityForMetadata = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    MediaType.TV,
    show.title,
    'metadata',
    { id: aggregatedData.showMetadata.metadataSource }
  )
  const shouldForceUpdate = (!show.metadata || !show.metadataSource) && isHighestPriorityForMetadata

  if (shouldForceUpdate || (newMetadataLastUpdated > existingMetadataLastUpdated && isHighestPriorityForMetadata)) {
    const updateData = {
      metadata: aggregatedData.showMetadata,
      metadataSource: aggregatedData.showMetadata.metadataSource ?? show.metadataSource
    }
    delete updateData.metadata.metadataSource

    const filteredUpdateData = filterLockedFields(show, updateData)
    
    // Only update if there are actual differences in the content
    if (Object.keys(filteredUpdateData).length > 0 && 
        !isEqual(show.metadata, updateData.metadata)) {
      console.log(`Updating show-level metadata for "${show.title}"...`)
      await updateMediaInDatabase(client, MediaType.TV, show.title, { $set: filteredUpdateData })
    } else {
      console.log(`No changes in show-level metadata for "${show.title}". Skipping update.`)
    }
  }

  // Season-level metadata
  for (const [seasonNumber, seasonAggData] of Object.entries(aggregatedData.seasons)) {
    const existingSeason = show.seasons.find((s) => s.seasonNumber === Number(seasonNumber))
    if (!existingSeason) continue

    if (seasonAggData.seasonMetadata) {
      const existingSeasonLastUpdated = new Date(
        existingSeason.metadata?.last_updated || '1970-01-01'
      )
      const newSeasonLastUpdated = new Date(
        seasonAggData.seasonMetadata.last_updated || '1970-01-01'
      )

      const isHighestPriorityForSeason = isCurrentServerHighestPriorityForField(
        fieldAvailability,
        MediaType.TV,
        show.title,
        `seasons.Season ${seasonNumber}.metadata`,
        { id: seasonAggData.metadataSource }
      )

      // Force update if metadata or source is missing
      const shouldForceUpdate = (!existingSeason.metadata || !existingSeason.metadataSource) && isHighestPriorityForSeason

      if (shouldForceUpdate || (newSeasonLastUpdated > existingSeasonLastUpdated && isHighestPriorityForSeason)) {
        const updateData = {
          [`seasons.$[elem].metadata`]: seasonAggData.seasonMetadata,
          [`seasons.$[elem].metadataSource`]: seasonAggData.seasonMetadata.metadataSource
        }
        delete updateData[`seasons.$[elem].metadata`].metadataSource

        // Check if there are actual changes in the content
        const hasChanges = !isEqual(existingSeason.metadata, seasonAggData.seasonMetadata)
        
        const filtered = filterLockedFields(existingSeason, seasonAggData.seasonMetadata)
        if (Object.keys(filtered).length > 0 && hasChanges) {
          console.log(
            `Updating season-level metadata for "${show.title}" - Season ${seasonNumber}`
          )
          await client
            .db('Media')
            .collection('TV')
            .updateOne(
              { title: show.title },
              { $set: updateData },
              { arrayFilters: [{ 'elem.seasonNumber': Number(seasonNumber) }] }
            )
        } else {
          console.log(
            `No changes in season-level metadata for "${show.title}" - Season ${seasonNumber}. Skipping update.`
          )
        }
      }
    }

    // Episode-level metadata
    for (const [episodeIndex, episodeMetadata] of Object.entries(
      seasonAggData.episodes
    )) {
      const dbEpisode = existingSeason.episodes.find(
        (e) => e.episodeNumber === Number(seasonAggData.episodes[episodeIndex].episode_number)
      )
      if (!dbEpisode) continue

      const existingEpisodeLastUpdated = new Date(
        dbEpisode?.metadata?.last_updated || '1970-01-01'
      )
      const newEpisodeLastUpdated = new Date(
        episodeMetadata.last_updated || '1970-01-01'
      )

      const isHighestPriorityForEpisode = isCurrentServerHighestPriorityForField(
        fieldAvailability,
        MediaType.TV,
        show.title,
        `seasons.Season ${seasonNumber}.episodes.S${seasonNumber.padStart(2, '0')}${`${dbEpisode.episodeNumber}`.padStart(2, '0')}.metadata`,
        { id: episodeMetadata.metadataSource }
      )

      // Force update if metadata or source is missing
      const shouldForceUpdate = (!dbEpisode.metadata || !dbEpisode.metadataSource) && isHighestPriorityForEpisode

      if (shouldForceUpdate || (newEpisodeLastUpdated > existingEpisodeLastUpdated && isHighestPriorityForEpisode)) {
        // Check if there are actual changes in the content
        const hasChanges = !isEqual(dbEpisode.metadata, episodeMetadata)
        
        const filtered = filterLockedFields(dbEpisode, episodeMetadata)
        if (Object.keys(filtered).length > 0 && hasChanges) {
          
          // Get current season's episode metadata array
          const currentSeasonData = await client
            .db('Media')
            .collection('TV')
            .findOne(
              { title: show.title, 'seasons.seasonNumber': Number(seasonNumber) },
              { projection: { 'seasons.$': 1 } }
            )

          const currentEpisodeMetadata = currentSeasonData?.seasons[0]?.metadata?.episodes || []
          
          // Find or create episode metadata entry
          const existingIndex = currentEpisodeMetadata.findIndex(
            ep => ep.episode_number === Number(dbEpisode.episodeNumber)
          )

          let updatedEpisodeMetadata = [...currentEpisodeMetadata]
          const newEpisodeMetadata = {
            ...episodeMetadata,
            episode_number: Number(dbEpisode.episodeNumber),
            season_number: Number(seasonNumber)
          }

          if (existingIndex !== -1) {
            // Only update if there are actual changes in the content
            const existingMetadata = currentEpisodeMetadata[existingIndex]
            const hasEpisodeChanges = !isEqual(existingMetadata, newEpisodeMetadata)
            const shouldUpdate = !existingMetadata || !existingMetadata.last_updated ||
              (newEpisodeLastUpdated > new Date(existingMetadata.last_updated || '1970-01-01') && hasEpisodeChanges)
            
            if (shouldUpdate) {
              updatedEpisodeMetadata[existingIndex] = newEpisodeMetadata
            } else {
              // console.log(
              //   `No changes in episode metadata for "${show.title}" S${seasonNumber}E${dbEpisode.episodeNumber}. Skipping update.`
              // )
              continue
            }
          } else {
            updatedEpisodeMetadata.push(newEpisodeMetadata)
          }

          // Sort episodes by episode number
          updatedEpisodeMetadata.sort((a, b) => a.episode_number - b.episode_number)

          // Update using enhanced database function
          await updateEpisodeInDatabase(client, show.title, Number(seasonNumber), Number(dbEpisode.episodeNumber), {
            set: {
              metadata: episodeMetadata,
              metadataSource: episodeMetadata.metadataSource
            },
            seasonMetadataEpisodes: updatedEpisodeMetadata
          })
        } /*else {
          console.log(
            `No changes in episode metadata for "${show.title}" S${seasonNumber}E${dbEpisode.episodeNumber}. Skipping update.`
          )
        }*/
      }
    }
  }
}

/**
 * Syncs metadata from server to database.
 * @param {Object} currentDB - Current database state
 * @param {Object} fileServer - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Sync results
 */
export async function syncMetadata(currentDB, fileServer, serverConfig, fieldAvailability) {
  console.log(chalk.bold.cyan(`Starting metadata sync for server ${serverConfig.id}...`))
  const client = await clientPromise
  const results = {
    processed: { movies: [], tv: [] },
    errors: { movies: [], tv: [] },
  }

  try {
    // Process movies concurrently
    await Promise.allSettled(
      currentDB.movies.map(async (movie) => {
        try {
          const aggregatedMetadata = await gatherMovieMetadataForAllServers(movie, { [serverConfig.id]: fileServer })
          await finalizeMovieMetadata(client, movie, aggregatedMetadata, fieldAvailability)
          results.processed.movies.push({
            title: movie.title,
            serverId: serverConfig.id,
          })
        } catch (error) {
          results.errors.movies.push({
            title: movie.title,
            serverId: serverConfig.id,
            error: error.message,
          })
        }
      })
    )

    // Process TV shows
    for (const show of currentDB.tv) {
      try {
        const aggregatedTVMetadata = await gatherTvMetadataForAllServers(show, { [serverConfig.id]: fileServer })
        await finalizeTvMetadata(client, show, aggregatedTVMetadata, fieldAvailability)
        results.processed.tv.push({
          title: show.title,
          serverId: serverConfig.id,
        })
      } catch (error) {
        results.errors.tv.push({
          title: show.title,
          serverId: serverConfig.id,
          error: error.message,
        })
      }
    }

    console.log(chalk.bold.cyan(`Finished metadata sync for server ${serverConfig.id}`))
    return results
  } catch (error) {
    console.error(`Error during metadata sync for server ${serverConfig.id}:`, error)
    throw error
  }
}
