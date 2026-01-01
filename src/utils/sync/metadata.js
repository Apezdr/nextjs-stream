import { createFullUrl, filterLockedFields, isSourceMatchingServer, isCurrentServerHighestPriorityForField, MediaType, findEpisodeFileName } from './utils'
import { updateEpisodeInDatabase, updateMediaInDatabase } from './database'
import clientPromise from '@src/lib/mongodb'
import chalk from 'chalk'
import { isEqual } from 'lodash'
import { fetchMetadataMultiServer } from '@src/utils/admin_utils'
import { getCacheBatch } from '@src/lib/cache'
import pLimit from 'p-limit'

const CONCURRENCY_LIMIT = 10
const limit = pLimit(CONCURRENCY_LIMIT)

/**
 * Determines the best metadata based on priority and last_updated.
 * @param {Array} metadataArray - Array of metadata objects with priority
 * @returns {Object|null} Best metadata or null
 */
function determineBestMetadata(metadataArray) {
  if (!metadataArray || metadataArray.length === 0) return null;
  
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
      const { id, priority } = fetchPromises[index].serverConfig;
      return {
        metadata,
        metadataSource: id,
        priority,
      };
    })
    .filter(Boolean);

  // 5) Determine the best metadata
  // (Same logic as used in TV code: pick the lowest priority, then newest last_updated.)
  const bestMetadata = determineBestMetadata(validMetadataArray);
  
  if (!bestMetadata) return null;

  if (bestMetadata.metadata && bestMetadata.metadata.release_date && typeof bestMetadata.metadata.release_date === 'string') {
    bestMetadata.metadata.release_date = new Date(bestMetadata.metadata.release_date);
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
  if (!bestMetadata || !bestMetadata.metadata) return;

  // Force update if metadata or source is missing
  const shouldForceUpdate = !movie.metadata || !movie.metadataSource;

  // Compare last_updated
  const existingMetadataLastUpdated = new Date(movie.metadata?.last_updated || '1970-01-01');
  const newMetadataLastUpdated = new Date(bestMetadata.metadata?.last_updated || '1970-01-01');

  // Check if current server has highest priority for metadata
  const isHighestPriorityForMetadata = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    MediaType.MOVIES,
    movie.title,
    'urls.metadata',
    { id: bestMetadata.metadataSource }
  );

  if (shouldForceUpdate || (newMetadataLastUpdated > existingMetadataLastUpdated && isHighestPriorityForMetadata)) {
    const updateData = {
      metadata: bestMetadata.metadata,
      metadataSource: bestMetadata.metadataSource
    };

    const filteredUpdateData = filterLockedFields(movie, updateData);
    if (Object.keys(filteredUpdateData).length === 0) {
      console.log(`All metadata fields locked for movie "${movie.title}". Skipping update.`);
      return;
    }

    console.log(`Movie: Updating metadata for "${movie.title}"...`);
    const preparedUpdateData = { $set: filteredUpdateData };
    await updateMediaInDatabase(client, MediaType.MOVIE, movie.title, preparedUpdateData);
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
    metadataSource: null,
    priority: null,
    seasons: {}
  };

  // Gather Show-Level Metadata Concurrently
  const showMetadataEntries = Object.entries(fileServers).map(([serverId, fileServer]) => {
    if (!fileServer.tv?.[show.title]) return null;
    const serverConfig = { id: serverId, ...fileServer.config };
    const metadataURL = fileServer.tv[show.title]?.metadata;
    if (!metadataURL) return null;

    const cacheKey = `${serverConfig.id}:file:${metadataURL}`;
    return { serverId, serverConfig, metadataURL, cacheKey };
  }).filter(Boolean);

  if (showMetadataEntries.length === 0) {
    //console.log(`No show metadata found for "${show.title}"`);
    return aggregatedData;
  }

  const showCacheKeys = showMetadataEntries.map(entry => entry.cacheKey);
  const cachedShowEntries = await getCacheBatch(showCacheKeys);

  const fetchShowPromises = showMetadataEntries.map((entry) => {
    const { serverId, serverConfig, metadataURL, cacheKey } = entry;
    const cachedEntry = cachedShowEntries[cacheKey];

    const headers = {};
    if (cachedEntry) {
      if (cachedEntry.etag) {
        headers['If-None-Match'] = cachedEntry.etag;
      }
      if (cachedEntry.lastModified) {
        headers['If-Modified-Since'] = cachedEntry.lastModified;
      }
    }

    return {
      serverId,
      serverConfig,
      metadataURL,
      headers,
      cacheKey,
    };
  });

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
  );

  // Filter out null responses and determine the best metadata
  const validShowMetadata = fetchShowData
    .map((data, index) => {
      if (!data) return null;
      const { id, priority } = showMetadataEntries[index].serverConfig;
      return { metadata: data, metadataSource: id, priority };
    })
    .filter(Boolean);

  const bestShowMetadata = determineBestMetadata(validShowMetadata);
  
  if (bestShowMetadata && bestShowMetadata.metadata) {
    aggregatedData.showMetadata = bestShowMetadata.metadata;
    aggregatedData.metadataSource = bestShowMetadata.metadataSource;
    aggregatedData.priority = bestShowMetadata.priority;
  } else {
    console.log(`No valid show metadata found for "${show.title}"`);
    return aggregatedData;
  }

  // Gather Season and Episode-Level Metadata Concurrently
  const seasonPromises = show.seasons.map(async (season) => {
    const { seasonNumber } = season;
    const seasonNumStr = String(seasonNumber);

    // Find the season metadata from the show metadata
    const showSeasonMetadata = aggregatedData.showMetadata?.seasons?.find(
      s => s.season_number === Number(seasonNumber)
    );

    // Initialize season data in aggregatedData
    aggregatedData.seasons[seasonNumStr] = {
      seasonMetadata: showSeasonMetadata ? { ...showSeasonMetadata } : null,
      metadataSource: aggregatedData.metadataSource,
      priority: aggregatedData.priority,
      episodes: []
    };

    // Gather Episode Metadata Concurrently
    const episodePromises = season.episodes.map(async (episode) => {
      const { episodeNumber } = episode;

      const episodeMetadataEntries = Object.entries(fileServers).map(([serverId, fileServer]) => {
        const serverConfig = { id: serverId, ...fileServer.config };
        const fileServerShowData = fileServer.tv?.[show.title];
        if (!fileServerShowData) return null;

        const seasonKey = `Season ${seasonNumber}`;
        const fsSeasonData = fileServerShowData.seasons?.[seasonKey];
        if (!fsSeasonData?.episodes) return null;

        const episodeFileName = findEpisodeFileName(
          Object.keys(fsSeasonData.episodes),
          seasonNumber,
          episodeNumber
        );
        if (!episodeFileName) return null;

        const episodeData = fsSeasonData.episodes[episodeFileName];
        if (!episodeData?.metadata) return null;

        const metadataURL = episodeData.metadata;
        const cacheKey = `${serverConfig.id}:file:${metadataURL}`;
        return { serverId, serverConfig, metadataURL, cacheKey, episodeFileName };
      }).filter(Boolean);

      if (episodeMetadataEntries.length === 0) return;

      const episodeCacheKeys = episodeMetadataEntries.map(entry => entry.cacheKey);
      const cachedEpisodeEntries = await getCacheBatch(episodeCacheKeys);

      const fetchEpisodePromises = episodeMetadataEntries.map((entry) => {
        const { serverId, serverConfig, metadataURL, cacheKey } = entry;
        const cachedEntry = cachedEpisodeEntries[cacheKey];

        const headers = {};
        if (cachedEntry) {
          if (cachedEntry.etag) {
            headers['If-None-Match'] = cachedEntry.etag;
          }
          if (cachedEntry.lastModified) {
            headers['If-Modified-Since'] = cachedEntry.lastModified;
          }
        }

        return {
          serverId,
          serverConfig,
          metadataURL,
          headers,
          cacheKey,
          episodeFileName: entry.episodeFileName,
        };
      });

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
      );

      const validEpisodeMetadata = fetchEpisodeData
        .map((data, index) => {
          if (!data) return null;
          const { id, priority } = fetchEpisodePromises[index].serverConfig;
          return { 
            metadata: data, 
            metadataSource: id, 
            priority,
            episodeFileName: fetchEpisodePromises[index].episodeFileName
          };
        })
        .filter(Boolean);

      const bestEpisodeMetadata = determineBestMetadata(validEpisodeMetadata);

      if (bestEpisodeMetadata && bestEpisodeMetadata.metadata) {
        // Create new episode metadata object
        const newEpisodeMetadata = {
          ...bestEpisodeMetadata.metadata,
          episode_number: Number(episodeNumber),
          season_number: Number(seasonNumber),
          metadataSource: bestEpisodeMetadata.metadataSource,
          episodeFileName: bestEpisodeMetadata.episodeFileName,
          priority: bestEpisodeMetadata.priority
        };

        // Add to the episodes array for this season
        aggregatedData.seasons[seasonNumStr].episodes.push(newEpisodeMetadata);
      }
    });

    await Promise.all(episodePromises);

    // Sort episodes by episode number
    if (aggregatedData.seasons[seasonNumStr].episodes.length > 0) {
      aggregatedData.seasons[seasonNumStr].episodes.sort((a, b) => 
        (a.episode_number || 0) - (b.episode_number || 0)
      );
    }
  });

  await Promise.all(seasonPromises);

  return aggregatedData;
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
  if (!aggregatedData?.showMetadata) {
    console.log(`No show metadata to finalize for "${show.title}"`);
    return;
  }

  // Show-level metadata
  const existingMetadataLastUpdated = new Date(show.metadata?.last_updated || '1970-01-01');
  const newMetadataLastUpdated = new Date(aggregatedData.showMetadata.last_updated || '1970-01-01');
  
  const isHighestPriorityForMetadata = isCurrentServerHighestPriorityForField(
    fieldAvailability,
    MediaType.TV,
    show.originalTitle,
    'metadata',
    { priority: aggregatedData.priority }
  );
  const shouldForceUpdate = (!show.metadata || !show.metadataSource) && isHighestPriorityForMetadata;

  if (shouldForceUpdate || (newMetadataLastUpdated > existingMetadataLastUpdated && isHighestPriorityForMetadata)) {
    const updateData = {
      metadata: aggregatedData.showMetadata,
      metadataSource: aggregatedData.metadataSource ?? show.metadataSource
    };
    
    // Make a copy to avoid modifying the original
    if (updateData.metadata && updateData.metadata.metadataSource) {
      delete updateData.metadata.metadataSource;
    }

    const filteredUpdateData = filterLockedFields(show, updateData);
    
    // Only update if there are actual differences in the content
    if (Object.keys(filteredUpdateData).length > 0 && 
        !isEqual(show.metadata, updateData.metadata)) {
      console.log(`Updating show-level metadata for "${show.title}"...`);
      await updateMediaInDatabase(client, MediaType.TV, show.title, { $set: filteredUpdateData });
    } /* else {
      console.log(`No changes in show-level metadata for "${show.title}". Skipping update.`);
    }*/
  }

  // Season-level metadata and episode updates
  for (const [seasonNumber, seasonAggData] of Object.entries(aggregatedData.seasons)) {
    const seasonNum = Number(seasonNumber);
    const existingSeason = show.seasons.find((s) => s.seasonNumber === seasonNum);
    if (!existingSeason) {
      console.log(`Season ${seasonNumber} not found for show "${show.title}". Skipping.`);
      continue;
    }

    // Update season metadata if available
    if (seasonAggData.seasonMetadata) {
      const existingSeasonLastUpdated = new Date(
        existingSeason.metadata?.last_updated || '1970-01-01'
      );
      const newSeasonLastUpdated = new Date(
        seasonAggData.seasonMetadata.last_updated || '1970-01-01'
      );

      // Force update if metadata or source is missing
      const shouldForceUpdate = !existingSeason.metadata || !existingSeason.metadataSource;

      if (shouldForceUpdate || (newSeasonLastUpdated > existingSeasonLastUpdated)) {
        // Preserve existing episodes array if it exists
        const existingEpisodes = existingSeason.metadata?.episodes || [];
        
        // Create a copy of the season metadata without overwriting episodes
        const seasonMetadataWithoutEpisodes = { ...seasonAggData.seasonMetadata };
        delete seasonMetadataWithoutEpisodes.episodes;
        
        // Create the final season metadata with preserved episodes
        const finalSeasonMetadata = {
          ...seasonMetadataWithoutEpisodes,
          episodes: existingEpisodes
        };

        const updateData = {
          [`seasons.$[elem].metadata`]: finalSeasonMetadata,
          [`seasons.$[elem].metadataSource`]: seasonAggData.metadataSource
        };
        
        // Check if there are actual changes in the content (excluding episodes array)
        const existingMetadataWithoutEpisodes = { ...existingSeason.metadata };
        delete existingMetadataWithoutEpisodes.episodes;
        
        const hasChanges = !isEqual(existingMetadataWithoutEpisodes, seasonMetadataWithoutEpisodes);
        
        if (hasChanges) {
          console.log(
            `Updating season-level metadata for "${show.title}" - Season ${seasonNumber}`
          );
          await client
            .db('Media')
            .collection('TV')
            .updateOne(
              { title: show.title },
              { $set: updateData },
              { arrayFilters: [{ 'elem.seasonNumber': Number(seasonNumber) }] }
            );
        } /*else {
          console.log(
            `No changes in season-level metadata for "${show.title}" - Season ${seasonNumber}. Skipping update.`
          );
        }*/
      }
    }

    // Update individual episode metadata
    for (const episodeMetadata of seasonAggData.episodes) {
      if (!episodeMetadata || !episodeMetadata.episode_number) {
        console.log(`Invalid episode metadata in season ${seasonNumber}. Skipping.`);
        continue;
      }
      
      const dbEpisode = existingSeason.episodes.find(
        (e) => e.episodeNumber === Number(episodeMetadata.episode_number)
      );
      
      if (!dbEpisode) {
        console.log(`Episode ${episodeMetadata.episode_number} not found in season ${seasonNumber}. Skipping.`);
        continue;
      }

      const existingEpisodeLastUpdated = new Date(
        dbEpisode?.metadata?.last_updated || '1970-01-01'
      );
      const newEpisodeLastUpdated = new Date(
        episodeMetadata.last_updated || '1970-01-01'
      );

      // Convert to strings for padStart
      const seasonNumStr = String(seasonNumber);
      const episodeNumStr = String(dbEpisode.episodeNumber);
      
      // Construct the field path for checking priority
      const fieldPath = `seasons.Season ${seasonNumStr}.episodes.${episodeMetadata.episodeFileName || `S${seasonNumStr.padStart(2, '0')}E${episodeNumStr.padStart(2, '0')}`}.metadata`;
      
      const isHighestPriorityForEpisode = isCurrentServerHighestPriorityForField(
        fieldAvailability,
        MediaType.TV,
        show.originalTitle,
        fieldPath,
        { priority: episodeMetadata.priority }
      );

      // Force update if metadata or source is missing
      const shouldForceUpdate = (!dbEpisode.metadata || !dbEpisode.metadataSource) && isHighestPriorityForEpisode;

      if (shouldForceUpdate || (newEpisodeLastUpdated > existingEpisodeLastUpdated && isHighestPriorityForEpisode)) {
        // Check if there are actual changes in the content
        const hasChanges = !isEqual(dbEpisode.metadata, episodeMetadata);
        
        const filtered = filterLockedFields(dbEpisode, episodeMetadata);
        if (Object.keys(filtered).length > 0 && hasChanges) {
          // Create a clean copy of the episode metadata
          const cleanEpisodeMetadata = { ...episodeMetadata };
          
          // Remove any fields that shouldn't be in the database
          if (cleanEpisodeMetadata.episodeFileName) {
            delete cleanEpisodeMetadata.episodeFileName;
          }
          if (cleanEpisodeMetadata.priority) {
            delete cleanEpisodeMetadata.priority;
          }

          try {
            // First update the individual episode's metadata
            await client
              .db('Media')
              .collection('TV')
              .updateOne(
                { 
                  title: show.title, 
                  'seasons.seasonNumber': Number(seasonNumber),
                  'seasons.episodes.episodeNumber': Number(dbEpisode.episodeNumber)
                },
                { 
                  $set: {
                    'seasons.$[season].episodes.$[episode].metadata': cleanEpisodeMetadata,
                    'seasons.$[season].episodes.$[episode].metadataSource': episodeMetadata.metadataSource
                  }
                },
                {
                  arrayFilters: [
                    { 'season.seasonNumber': Number(seasonNumber) },
                    { 'episode.episodeNumber': Number(dbEpisode.episodeNumber) }
                  ]
                }
              );
            
            // Then update the episode in the season's metadata.episodes array
            // First get the current season metadata
            const currentSeasonData = await client
              .db('Media')
              .collection('TV')
              .findOne(
                { title: show.title, 'seasons.seasonNumber': Number(seasonNumber) },
                { projection: { 'seasons.$': 1 } }
              );
            
            // Get the current episodes array from season metadata
            const currentEpisodes = currentSeasonData?.seasons[0]?.metadata?.episodes || [];
            
            // Find the episode in the array or add it if it doesn't exist
            const episodeIndex = currentEpisodes.findIndex(
              ep => ep.episode_number === Number(dbEpisode.episodeNumber)
            );
            
            // Create a clean copy for the season's episodes array
            const episodeForSeasonMetadata = {
              ...cleanEpisodeMetadata,
              episode_number: Number(dbEpisode.episodeNumber),
              season_number: Number(seasonNumber)
            };
            
            let updatedEpisodes = [...currentEpisodes];
            
            if (episodeIndex !== -1) {
              // Update existing episode
              updatedEpisodes[episodeIndex] = episodeForSeasonMetadata;
            } else {
              // Add new episode
              updatedEpisodes.push(episodeForSeasonMetadata);
            }
            
            // Sort episodes by episode number
            updatedEpisodes.sort((a, b) => 
              (a.episode_number || 0) - (b.episode_number || 0)
            );
            
            // Update the season's metadata.episodes array
            await client
              .db('Media')
              .collection('TV')
              .updateOne(
                { title: show.title, 'seasons.seasonNumber': Number(seasonNumber) },
                { $set: { 'seasons.$[season].metadata.episodes': updatedEpisodes } },
                { arrayFilters: [{ 'season.seasonNumber': Number(seasonNumber) }] }
              );
              
            console.log(`Successfully updated episode metadata for "${show.title}" S${seasonNumber}E${dbEpisode.episodeNumber}`);
          } catch (error) {
            console.error(`Error updating episode metadata for "${show.title}" S${seasonNumber}E${dbEpisode.episodeNumber}:`, error);
          }
        } else {
          console.log(
            `No changes in episode metadata for "${show.title}" S${seasonNumber}E${dbEpisode.episodeNumber}. Skipping update.`
          );
        }
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
  console.log(chalk.bold.cyan(`Starting metadata sync for server ${serverConfig.id}...`));
  const client = await clientPromise;
  const results = {
    processed: { movies: [], tv: [] },
    errors: { movies: [], tv: [] },
  };

  try {
    // Process movies concurrently
    await Promise.allSettled(
      currentDB.movies.map(async (movie) => {
        try {
          const aggregatedMetadata = await gatherMovieMetadataForAllServers(movie, { [serverConfig.id]: fileServer });
          await finalizeMovieMetadata(client, movie, aggregatedMetadata, fieldAvailability);
          results.processed.movies.push({
            title: movie.title,
            serverId: serverConfig.id,
          });
        } catch (error) {
          results.errors.movies.push({
            title: movie.title,
            serverId: serverConfig.id,
            error: error.message,
          });
        }
      })
    );

    // Process TV shows
    for (const show of currentDB.tv) {
      try {
        const aggregatedTVMetadata = await gatherTvMetadataForAllServers(show, { [serverConfig.id]: fileServer });
        await finalizeTvMetadata(client, show, aggregatedTVMetadata, fieldAvailability);
        results.processed.tv.push({
          title: show.title,
          serverId: serverConfig.id,
        });
      } catch (error) {
        results.errors.tv.push({
          title: show.title,
          serverId: serverConfig.id,
          error: error.message,
        });
      }
    }

    console.log(chalk.bold.cyan(`Finished metadata sync for server ${serverConfig.id}`));
    return results;
  } catch (error) {
    console.error(`Error during metadata sync for server ${serverConfig.id}:`, error);
    // Instead of throwing the error, add it to the results and return
    results.errors.general = {
      message: error.message,
      stack: error.stack
    };
    return results;
  }
}
