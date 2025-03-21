import { isCurrentServerHighestPriorityForField, MediaType, findEpisodeFileName } from './utils'
import { updateMediaInDatabase, updateEpisodeInDatabase } from './database'
import clientPromise from '@src/lib/mongodb'
import chalk from 'chalk'
import { isEqual } from 'lodash'

/**
 * Gathers video info for a movie from all servers.
 * @param {Object} movie - Movie object
 * @param {Object} fileServers - File servers data
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Object} Aggregated video info
 */
export function gatherMovieVideoInfoForAllServers(movie, fileServers, fieldAvailability) {
  // Track both values and their sources with priorities
  const aggregatedWithSources = {
    dimensions: { value: null, priority: Infinity, source: null },
    length: { value: null, priority: Infinity, source: null },
    hdr: { value: null, priority: Infinity, source: null },
    size: { value: null, priority: Infinity, source: null },
    mediaQuality: { value: null, priority: Infinity, source: null },
  }
  
  // Track if any field was updated
  let videoInfoSource = null;

  for (const [serverId, fileServer] of Object.entries(fileServers)) {
    const serverConfig = {
      id: serverId,
      ...fileServer.config,
    }

    const fileServerData = fileServer.movies?.[movie.title]
    if (!fileServerData?.fileNames) continue

    const mp4File = fileServerData.fileNames.find((n) => n.endsWith('.mp4'))
    if (!mp4File) continue

    // Check if this server could be highest priority for any field
    const fields = [
      `dimensions.${mp4File}`,
      `length.${mp4File}`,
      'hdr',
      'additional_metadata.size',
      'mediaQuality.format',
      'mediaQuality.bitDepth',
      'mediaQuality.colorSpace',
      'mediaQuality.transferCharacteristics',
      'mediaQuality.isHDR',
      'mediaQuality.viewingExperience.enhancedColor',
      'mediaQuality.viewingExperience.highDynamicRange',
      'mediaQuality.viewingExperience.dolbyVision',
      'mediaQuality.viewingExperience.hdr10Plus',
      'mediaQuality.viewingExperience.standardHDR'
    ]
    const hasHighestPriorityForAnyField = fields.some(field => 
      isCurrentServerHighestPriorityForField(
        fieldAvailability,
        MediaType.MOVIES,
        movie.title,
        field,
        serverConfig
      )
    )

    if (!hasHighestPriorityForAnyField) {
      continue // Skip this server if it's not highest priority for any field
    }

    const newDimensions = fileServerData.dimensions?.[mp4File]
    const newLength = fileServerData.length?.[mp4File]
    const newHdr = fileServerData.hdr
    const newSize = fileServerData?.additional_metadata?.size
    const newMediaQuality = fileServerData.mediaQuality

    // Check each field's priority independently
    const fieldsToCheck = {
      dimensions: { value: newDimensions, path: `dimensions.${mp4File}` },
      length: { value: newLength, path: `length.${mp4File}` },
      hdr: { value: newHdr, path: 'hdr' },
      size: { value: newSize, path: 'additional_metadata.size' }
    }

    let updated = false
    
    // Process standard fields
    for (const [field, { value, path }] of Object.entries(fieldsToCheck)) {
      // Skip null/undefined values
      if (value === null || value === undefined) continue

      const isHighestPriority = isCurrentServerHighestPriorityForField(
        fieldAvailability,
        MediaType.MOVIES,
        movie.title,
        path,
        serverConfig
      )

      // Only update if this server has highest priority AND
      // either we don't have a value yet OR this server has higher priority
      if (isHighestPriority && serverConfig.priority < aggregatedWithSources[field].priority) {
        aggregatedWithSources[field] = {
          value: value,
          priority: serverConfig.priority,
          source: serverConfig.id
        }
        updated = true
      }
    }
    
    // Process mediaQuality fields separately to handle nested properties
    if (newMediaQuality) {
      // Check if any mediaQuality field has highest priority
      const mediaQualityFields = [
        'mediaQuality.format',
        'mediaQuality.bitDepth',
        'mediaQuality.colorSpace',
        'mediaQuality.transferCharacteristics',
        'mediaQuality.isHDR',
        'mediaQuality.viewingExperience.enhancedColor',
        'mediaQuality.viewingExperience.highDynamicRange',
        'mediaQuality.viewingExperience.dolbyVision',
        'mediaQuality.viewingExperience.hdr10Plus',
        'mediaQuality.viewingExperience.standardHDR'
      ];
      
      let hasAnyMediaQualityPriority = false;
      
      for (const fieldPath of mediaQualityFields) {
        const isHighestPriority = isCurrentServerHighestPriorityForField(
          fieldAvailability,
          MediaType.MOVIES,
          movie.title,
          fieldPath,
          serverConfig
        );
        
        if (isHighestPriority) {
          hasAnyMediaQualityPriority = true;
          break;
        }
      }
      
      // If this server has priority for any mediaQuality field and has higher priority
      // than the current source, use its entire mediaQuality object
      if (hasAnyMediaQualityPriority && 
          serverConfig.priority < aggregatedWithSources.mediaQuality.priority) {
        aggregatedWithSources.mediaQuality = {
          value: newMediaQuality,
          priority: serverConfig.priority,
          source: serverConfig.id
        };
        updated = true;
      }
    }

    // Update source if any field was updated
    if (updated) {
      videoInfoSource = serverConfig.id;
    }
  }

  // Convert back to the expected format before returning
  return {
    dimensions: aggregatedWithSources.dimensions.value,
    length: aggregatedWithSources.length.value,
    hdr: aggregatedWithSources.hdr.value,
    size: aggregatedWithSources.size.value,
    mediaQuality: aggregatedWithSources.mediaQuality.value,
    videoInfoSource: videoInfoSource,
  }
}

/**
 * Finalizes movie video info in the database.
 * @param {Object} client - Database client
 * @param {Object} movie - Movie object
 * @param {Object} aggregated - Aggregated video info
 * @returns {Promise<void>}
 */
export async function finalizeMovieVideoInfo(client, movie, aggregated) {
  const updates = {}
  let changed = false

  // Compare each field
  if (aggregated.dimensions && !isEqual(movie.dimensions, aggregated.dimensions)) {
    updates.dimensions = aggregated.dimensions || null
    changed = true
  }

  if (aggregated.length && !isEqual(movie.duration, aggregated.length)) {
    updates.duration = aggregated.length || null
    changed = true
  }

  if (aggregated.hdr && !isEqual(movie.hdr, aggregated.hdr)) {
    updates.hdr = aggregated.hdr || null
    changed = true
  }

  if (aggregated.size && !isEqual(movie.size, aggregated.size)) {
    updates.size = aggregated.size || null
    changed = true
  }
  
  if (aggregated.mediaQuality && !isEqual(movie.mediaQuality ?? {}, aggregated.mediaQuality)) {
    updates.mediaQuality = aggregated.mediaQuality || null
    changed = true
  }
  
  if (aggregated.videoInfoSource && !isEqual(movie.videoInfoSource, aggregated.videoInfoSource)) {
    updates.videoInfoSource = aggregated.videoInfoSource || null
    changed = true
  }

  if (changed) {
    console.log(`Updating video info for movie "${movie.title}"...`)
    await updateMediaInDatabase(
      client,
      MediaType.MOVIE,
      movie.title,
      { $set: updates }
    )
  }
}

/**
 * Gathers video info for a TV season from all servers.
 * @param {Object} show - Show object
 * @param {Object} season - Season object
 * @param {Object} fileServers - File servers data
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Object} Aggregated video info
 */
export function gatherSeasonVideoInfoForAllServers(show, season, fileServers, fieldAvailability) {
  // Initialize an empty object to store aggregated data for each episode
  const aggregated = {}

  // For each server
  for (const [serverId, fileServer] of Object.entries(fileServers)) {
    const serverConfig = {
      id: serverId,
      ...fileServer.config,
    }
    const fileServerShowData = fileServer.tv?.[show.title]
    if (!fileServerShowData) continue

    const seasonKey = `Season ${season.seasonNumber}`
    const fileServerSeasonData = fileServerShowData.seasons?.[seasonKey]
    if (!fileServerSeasonData?.episodes) continue

    // For each episode in the DB season
    for (const episode of season.episodes) {
      const episodeNumber = episode.episodeNumber
      const episodeFileName = findEpisodeFileName(
        Object.keys(fileServerSeasonData.episodes),
        season.seasonNumber,
        episodeNumber
      )
      if (!episodeFileName) continue

      const fileData = fileServerSeasonData.episodes[episodeFileName]
      if (!fileData) continue

      // Check if this server could be highest priority for any field for this episode
      const fields = [
        `seasons.Season ${season.seasonNumber}.dimensions.${episodeFileName}`,
        `seasons.Season ${season.seasonNumber}.lengths.${episodeFileName}`,
        `seasons.Season ${season.seasonNumber}.episodes.${episodeFileName}.hdr`,
        `seasons.Season ${season.seasonNumber}.episodes.${episodeFileName}.additionalMetadata.size`,
        `seasons.Season ${season.seasonNumber}.episodes.${episodeFileName}.mediaQuality.format`,
        `seasons.Season ${season.seasonNumber}.episodes.${episodeFileName}.mediaQuality.bitDepth`,
        `seasons.Season ${season.seasonNumber}.episodes.${episodeFileName}.mediaQuality.colorSpace`,
        `seasons.Season ${season.seasonNumber}.episodes.${episodeFileName}.mediaQuality.transferCharacteristics`,
        `seasons.Season ${season.seasonNumber}.episodes.${episodeFileName}.mediaQuality.isHDR`,
        `seasons.Season ${season.seasonNumber}.episodes.${episodeFileName}.mediaQuality.viewingExperience.enhancedColor`,
        `seasons.Season ${season.seasonNumber}.episodes.${episodeFileName}.mediaQuality.viewingExperience.highDynamicRange`,
        `seasons.Season ${season.seasonNumber}.episodes.${episodeFileName}.mediaQuality.viewingExperience.dolbyVision`,
        `seasons.Season ${season.seasonNumber}.episodes.${episodeFileName}.mediaQuality.viewingExperience.hdr10Plus`,
        `seasons.Season ${season.seasonNumber}.episodes.${episodeFileName}.mediaQuality.viewingExperience.standardHDR`
      ]
      const hasHighestPriorityForAnyField = fields.some(field => 
        isCurrentServerHighestPriorityForField(
          fieldAvailability,
          MediaType.TV,
          show.title,
          field,
          serverConfig
        )
      )

      if (!hasHighestPriorityForAnyField) {
        continue // Skip this episode if server isn't highest priority for any field
      }

      const additionalMetadata = fileData.additionalMetadata || {}
      const dimensions = fileServerSeasonData.dimensions?.[episodeFileName] || null
      const length =
        fileServerSeasonData.lengths?.[episodeFileName] ||
        additionalMetadata.duration ||
        null
      const hdr = fileData.hdr || null
      const size = additionalMetadata.size || null
      const mediaQuality = fileData.mediaQuality || null

      // Initialize episode data with source tracking if it doesn't exist
      if (!aggregated[episodeNumber]) {
        aggregated[episodeNumber] = {
          // Track both values and their sources with priorities
          dimensions: { value: null, priority: Infinity, source: null },
          duration: { value: null, priority: Infinity, source: null },
          hdr: { value: null, priority: Infinity, source: null },
          size: { value: null, priority: Infinity, source: null },
          mediaQuality: { value: null, priority: Infinity, source: null },
          videoInfoSource: null,
        }
      }

      const epData = aggregated[episodeNumber]
      let updated = false

      // Check each field's priority independently
      const fieldsToCheck = {
        dimensions: { value: dimensions, path: `seasons.Season ${season.seasonNumber}.dimensions.${episodeFileName}` },
        duration: { value: length, path: `seasons.Season ${season.seasonNumber}.lengths.${episodeFileName}` },
        hdr: { value: hdr, path: `seasons.Season ${season.seasonNumber}.episodes.${episodeFileName}.hdr` },
        size: { value: size, path: `seasons.Season ${season.seasonNumber}.episodes.${episodeFileName}.additionalMetadata.size` }
      }
      
      // Process standard fields
      for (const [field, { value, path }] of Object.entries(fieldsToCheck)) {
        // Skip null/undefined values
        if (value === null || value === undefined) continue

        const isHighestPriority = isCurrentServerHighestPriorityForField(
          fieldAvailability,
          MediaType.TV,
          show.title,
          path,
          serverConfig
        )

        // Only update if this server has highest priority AND
        // either we don't have a value yet OR this server has higher priority
        if (isHighestPriority && serverConfig.priority < epData[field].priority) {
          epData[field] = {
            value: value,
            priority: serverConfig.priority,
            source: serverConfig.id
          }
          updated = true
        }
      }
      
      // Process mediaQuality fields separately to handle nested properties
      if (mediaQuality) {
        // Check if any mediaQuality field has highest priority
        const mediaQualityFields = [
          `seasons.Season ${season.seasonNumber}.episodes.${episodeFileName}.mediaQuality.format`,
          `seasons.Season ${season.seasonNumber}.episodes.${episodeFileName}.mediaQuality.bitDepth`,
          `seasons.Season ${season.seasonNumber}.episodes.${episodeFileName}.mediaQuality.colorSpace`,
          `seasons.Season ${season.seasonNumber}.episodes.${episodeFileName}.mediaQuality.transferCharacteristics`,
          `seasons.Season ${season.seasonNumber}.episodes.${episodeFileName}.mediaQuality.isHDR`,
          `seasons.Season ${season.seasonNumber}.episodes.${episodeFileName}.mediaQuality.viewingExperience.enhancedColor`,
          `seasons.Season ${season.seasonNumber}.episodes.${episodeFileName}.mediaQuality.viewingExperience.highDynamicRange`,
          `seasons.Season ${season.seasonNumber}.episodes.${episodeFileName}.mediaQuality.viewingExperience.dolbyVision`,
          `seasons.Season ${season.seasonNumber}.episodes.${episodeFileName}.mediaQuality.viewingExperience.hdr10Plus`,
          `seasons.Season ${season.seasonNumber}.episodes.${episodeFileName}.mediaQuality.viewingExperience.standardHDR`
        ];
        
        let hasAnyMediaQualityPriority = false;
        
        for (const fieldPath of mediaQualityFields) {
          const isHighestPriority = isCurrentServerHighestPriorityForField(
            fieldAvailability,
            MediaType.TV,
            show.title,
            fieldPath,
            serverConfig
          );
          
          if (isHighestPriority) {
            hasAnyMediaQualityPriority = true;
            break;
          }
        }
        
        // If this server has priority for any mediaQuality field and has higher priority
        // than the current source, use its entire mediaQuality object
        if (hasAnyMediaQualityPriority && 
            serverConfig.priority < epData.mediaQuality.priority) {
          epData.mediaQuality = {
            value: mediaQuality,
            priority: serverConfig.priority,
            source: serverConfig.id
          };
          updated = true;
        }
      }

      // Update source if any field was updated
      if (updated) {
        epData.videoInfoSource = serverConfig.id
      }
    }
  }

  // Convert back to the expected format before returning
  const result = {};
  
  for (const [episodeNumber, epData] of Object.entries(aggregated)) {
    result[episodeNumber] = {
      dimensions: epData.dimensions.value,
      duration: epData.duration.value,
      hdr: epData.hdr.value,
      size: epData.size.value,
      mediaQuality: epData.mediaQuality.value,
      videoInfoSource: epData.videoInfoSource,
    };
  }

  return result;
}

/**
 * Finalizes TV season video info in the database.
 * @param {Object} client - Database client
 * @param {Object} show - Show object
 * @param {Object} season - Season object
 * @param {Object} aggregatedSeasonData - Aggregated video info
 * @returns {Promise<void>}
 */
export async function finalizeSeasonVideoInfo(client, show, season, aggregatedSeasonData) {
  for (const episode of season.episodes) {
    const episodeNumber = episode.episodeNumber
    const bestData = aggregatedSeasonData[episodeNumber]
    if (!bestData) continue

    const changes = {}
    let changed = false

  if (bestData.dimensions && !isEqual(episode.dimensions, bestData.dimensions)) {
    changes.dimensions = bestData.dimensions || null
    changed = true
  }
  if (bestData.duration && (episode.duration !== bestData.duration || episode.length !== bestData.duration)) {
    changes.duration = bestData.duration || null
    changes.length = bestData.duration || null
    changed = true
  }
  if (bestData.hdr !== undefined && episode.hdr !== bestData.hdr) {
    changes.hdr = bestData.hdr || null
    changed = true
  }
  if (bestData.size !== undefined && episode.size !== bestData.size) {
    changes.size = bestData.size || null
    changed = true
  }
  
  if (bestData.mediaQuality && !isEqual(episode.mediaQuality, bestData.mediaQuality)) {
    changes.mediaQuality = bestData.mediaQuality || null
    changed = true
  }

    if (changed) {
      // Update videoInfoSource if it has changed
      if (!isEqual(episode.videoInfoSource, bestData.videoInfoSource)) {
        changes.videoInfoSource = bestData.videoInfoSource
      }

      await updateEpisodeInDatabase(client, show.title, season.seasonNumber, episodeNumber, {
        set: changes
      })

      console.log(
        `Updated video info for ${show.title} - Season ${season.seasonNumber}, Episode ${episodeNumber}`
      )
    }
  }
}

/**
 * Syncs video information from server to database.
 * @param {Object} currentDB - Current database state
 * @param {Object} fileServer - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Sync results
 */
export async function syncVideoInfo(currentDB, fileServer, serverConfig, fieldAvailability) {
  const client = await clientPromise
  console.log(
    chalk.bold.greenBright(`Starting video information sync for server ${serverConfig.id}...`)
  )

  const results = {
    processed: { movies: [], tv: [] },
    errors: { movies: [], tv: [] },
  }

  try {
    // Process TV shows
    for (const show of currentDB.tv) {
      const fileServerShowData = fileServer?.tv[show.title]
      if (!fileServerShowData) continue

      try {
        // Process seasons concurrently
        const seasonResults = await Promise.allSettled(
          show.seasons.map(async (season) => {
            const aggregatedData = gatherSeasonVideoInfoForAllServers(show, season, { [serverConfig.id]: fileServer }, fieldAvailability)
            await finalizeSeasonVideoInfo(client, show, season, aggregatedData)
            return { success: true }
          })
        )

        const processedSeasons = seasonResults.filter(result => result.status === 'fulfilled').length

        if (processedSeasons > 0) {
          results.processed.tv.push({
            title: show.title,
            serverId: serverConfig.id,
            processedSeasons,
          })
        }
      } catch (error) {
        results.errors.tv.push({
          title: show.title,
          serverId: serverConfig.id,
          error: error.message,
        })
      }
    }

    // Process movies concurrently
    await Promise.allSettled(
      currentDB.movies.map(async (movie) => {
        try {
          const aggregatedData = gatherMovieVideoInfoForAllServers(movie, { [serverConfig.id]: fileServer }, fieldAvailability)
          await finalizeMovieVideoInfo(client, movie, aggregatedData)
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

    console.log(
      chalk.bold.greenBright(`Video information sync complete for server ${serverConfig.id}.`)
    )
    return results
  } catch (error) {
    console.error(`Error during video information sync for server ${serverConfig.id}:`, error)
    // Instead of throwing the error, add it to the results and return
    results.errors.general = {
      message: error.message,
      stack: error.stack
    }
    return results
  }
}
