/**
 * TV episode sync utilities for flat database structure
 *
 * This module provides functions to sync TV episodes between file servers
 * and the flat database structure. It includes both traditional sync methods
 * and optimized hash-based sync for improved performance.
 */

import clientPromise from '@src/lib/mongodb'
import chalk from 'chalk'
import { ObjectId } from 'mongodb'
import { createEpisodeInFlatDB, getEpisodeFromFlatDB, updateEpisodeInFlatDB } from './database'
import { getTVShowFromFlatDB } from '../tvShows/database'
import { getSeasonFromFlatDB } from '../seasons/database'
import { syncEpisodeMetadata, syncShowEpisodesMetadataWithHashes } from './metadata'
import { syncEpisodeVideoURL } from './videoUrl'
import { syncEpisodeVideoInfo } from './videoInfo'
import { syncEpisodeThumbnail, syncEpisodeThumbnailBlurhash } from './thumbnail'
import { syncEpisodeCaptions } from './captions'
import { syncEpisodeChapters } from './chapters'
import { createFullUrl, findEpisodeFileName } from '../../sync/utils'
import { fetchHashData, getStoredHash, storeHash } from '../hashStorage'

/**
 * Syncs a single TV episode from file server to flat database structure
 * @param {Object} client - MongoDB client
 * @param {Object} show - TV show object from current database
 * @param {Object} season - Season object from current database
 * @param {Object} episode - Episode object from current database OR a temporary object with episodeNumber, seasonNumber, and showTitle
 * @param {Object} fileServerShowData - File server data for this show
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @param {Object} season_hashData - Hash data for the season
 * @param {boolean} skipMetadataProcessing - Flag to skip metadata processing
 * @returns {Promise<Object>} Sync results for this episode
 */
async function syncSingleEpisode(
  client,
  show,
  season,
  episode,
  fileServerShowData,
  serverConfig,
  fieldAvailability,
  season_hashData,
  skipMetadataProcessing = false
) {
  const results = {
    showTitle: show.title,
    seasonNumber: season.seasonNumber,
    episodeNumber: episode.episodeNumber,
    updated: false,
    fields: [],
    errors: [],
  }

  try {
    // Get the file server data for this season - early exit if not found
    const seasonKey = `Season ${season.seasonNumber}`
    const fileServerSeasonData = fileServerShowData?.seasons?.[seasonKey]
    if (!fileServerSeasonData) return results

    // Check if this episode exists in the file server data - early exit if not found
    const episodeFileName = findEpisodeFileName(
      Object.keys(fileServerSeasonData.episodes || {}),
      season.seasonNumber,
      episode.episodeNumber
    )

    if (!episodeFileName) return results

    // Get the file server episode data - early exit if not found
    const fileServerEpisodeData = fileServerSeasonData.episodes[episodeFileName]
    if (!fileServerEpisodeData) return results

    // Get all necessary IDs from the flat database upfront (only once)
    const [flatShow, flatSeason] = await Promise.all([
      getTVShowFromFlatDB(client, show.originalTitle),
      getSeasonFromFlatDB(client, show.title, season.seasonNumber),
    ])

    if (!flatShow) {
      results.errors.push({ field: 'general', error: 'TV show not found in flat structure' })
      return results
    }

    if (!flatSeason) {
      results.errors.push({ field: 'general', error: 'Season not found in flat structure' })
      return results
    }

    const seasonMetadata = flatShow.metadata?.seasons?.find(
      (s) => s.season_number === season.seasonNumber
    )

    // Explicitly check if the episode exists in the flat database
    let flatEpisode = await getEpisodeFromFlatDB(
      client,
      show.originalTitle,
      season.seasonNumber,
      episode.episodeNumber,
      true
    )

    if (!flatEpisode) {
      // Episode does not exist, explicitly create it
      const newVideoURL = createFullUrl(fileServerEpisodeData?.videoURL, serverConfig)
      const newEpisodeData = {
        showId: flatShow._id,
        seasonId: flatSeason._id,
        showTitle: show.title,
        seasonNumber: season.seasonNumber,
        episodeNumber: episode.episodeNumber,
        type: 'episode',
        createdAt: new Date(),
        ...(fileServerEpisodeData.videoURL && {
          videoSource: serverConfig.id,
          videoURL: newVideoURL,
        }),
      }

      // Use our improved createEpisodeInFlatDB function which handles duplicates
      const createResult = await createEpisodeInFlatDB(client, newEpisodeData)

      // If there was an existing episode found during creation, use that instead
      if (createResult.existing) {
        // Fetch the existing episode to make sure we have the full data
        flatEpisode = await getEpisodeFromFlatDB(
          client,
          show.title,
          season.seasonNumber,
          episode.episodeNumber
        )
        //console.log(`Episode "${show.title}" S${season.seasonNumber}E${episode.episodeNumber} exists, proceeding with updates.`);

        // Ensure the episode has the correct seasonId
        if (flatEpisode.seasonId.toString() !== flatSeason._id.toString()) {
          console.log(
            chalk.yellow(
              `Fixing inconsistent seasonId for episode "${show.title}" S${season.seasonNumber}E${episode.episodeNumber}`
            )
          )
          flatEpisode.seasonId = flatSeason._id
          // Update will happen later with other fields
        }
      } else {
        // Otherwise use our new episode data
        flatEpisode = newEpisodeData
        results.created = true
        console.log(
          `Created new episode "${show.title}" S${season.seasonNumber}E${episode.episodeNumber}`
        )
      }
    } /* else {
      console.log(`Episode "${show.title}" S${season.seasonNumber}E${episode.episodeNumber} exists, proceeding with updates.`);
    } */

    // Prepare sync functions with common parameters
    const syncFunctions = []

    // Only add sync operations for fields that exist in the file server data
    // This avoids unnecessary processing and database lookups

    // Metadata sync
    if (fileServerEpisodeData.metadata && !skipMetadataProcessing) {
      syncFunctions.push(
        syncEpisodeMetadata(
          client,
          show,
          season,
          episode,
          fileServerSeasonData,
          serverConfig,
          fieldAvailability,
          season_hashData
        )
          .then((result) => {
            if (result) {
              results.fields.push('metadata')
              return result // Return the full result object, not just true
            }
            return null
          })
          .catch((error) => {
            results.errors.push({ field: 'metadata', error: error.message })
            return null
          })
      )
    }

    // Video URL sync
    if (fileServerEpisodeData.videoURL) {
      syncFunctions.push(
        syncEpisodeVideoURL(
          client,
          show,
          season,
          episode,
          flatShow,
          flatSeason,
          flatEpisode,
          fileServerSeasonData,
          serverConfig,
          fieldAvailability
        )
          .then((result) => {
            if (result) {
              results.fields.push('videoUrl')
              return result // Return the full result object, not just true
            }
            return null
          })
          .catch((error) => {
            results.errors.push({ field: 'videoUrl', error: error.message })
            return null
          })
      )
    }
    
    // Video info sync - only run if mediaQuality exists
    if (fileServerEpisodeData.mediaQuality) {
      syncFunctions.push(
        syncEpisodeVideoInfo(
          client,
          show,
          season,
          episode,
          flatShow,
          flatSeason,
          flatEpisode,
          fileServerSeasonData,
          serverConfig,
          fieldAvailability
        )
          .then((result) => {
            if (result) {
              results.fields.push('videoInfo')
              return result // Return the full result object, not just true
            }
            return null
          })
          .catch((error) => {
            results.errors.push({ field: 'videoInfo', error: error.message })
            return null
          })
      )
    }

    // Thumbnail sync
    if (fileServerEpisodeData.thumbnail) {
      syncFunctions.push(
        syncEpisodeThumbnail(
          client,
          show,
          season,
          episode,
          flatShow,
          flatSeason,
          flatEpisode,
          fileServerSeasonData,
          serverConfig,
          fieldAvailability
        )
          .then((result) => {
            if (result) {
              results.fields.push('thumbnail')
              return result // Return the full result object, not just true
            }
            return null
          })
          .catch((error) => {
            results.errors.push({ field: 'thumbnail', error: error.message })
            return null
          })
      )
    }

    // Thumbnail blurhash sync
    if (fileServerEpisodeData.thumbnailBlurhash) {
      syncFunctions.push(
        syncEpisodeThumbnailBlurhash(
          client,
          show,
          season,
          episode,
          flatShow,
          flatSeason,
          flatEpisode,
          fileServerSeasonData,
          serverConfig,
          fieldAvailability
        )
          .then((result) => {
            if (result) {
              results.fields.push('thumbnailBlurhash')
              return result // Return the full result object, not just true
            }
            return null
          })
          .catch((error) => {
            results.errors.push({ field: 'thumbnailBlurhash', error: error.message })
            return null
          })
      )
    }

    // Captions sync
    if (fileServerEpisodeData.subtitles) {
      syncFunctions.push(
        syncEpisodeCaptions(
          client,
          show,
          season,
          episode,
          flatShow,
          flatSeason,
          flatEpisode,
          fileServerSeasonData,
          serverConfig,
          fieldAvailability
        )
          .then((result) => {
            if (result) {
              results.fields.push('captions')
              return result // Return the full result object, not just true
            }
            return null
          })
          .catch((error) => {
            results.errors.push({ field: 'captions', error: error.message })
            return null
          })
      )
    }

    // Chapters sync
    if (fileServerEpisodeData.chapters) {
      syncFunctions.push(
        syncEpisodeChapters(
          client,
          show,
          season,
          episode,
          flatShow,
          flatSeason,
          flatEpisode,
          fileServerSeasonData,
          serverConfig,
          fieldAvailability
        )
          .then((result) => {
            if (result) {
              results.fields.push('chapters')
              return result // Return the full result object, not just true
            }
            return null
          })
          .catch((error) => {
            results.errors.push({ field: 'chapters', error: error.message })
            return null
          })
      )
    }

    // Run all sync operations in parallel
    const syncResults = await Promise.all(syncFunctions)

    // Collect all updates from the sync operations
    const allUpdates = {}
    let hasUpdates = false

    syncResults.forEach((result) => {
      if (result && typeof result === 'object') {
        // If the result has a field property, it's a success indicator
        if (result.field && result.updated) {
          hasUpdates = true

          // Extract the update data by removing the status properties
          const { field, updated, ...updateData } = result

          // Add the update data to the combined updates
          if (Object.keys(updateData).length > 0) {
            Object.assign(allUpdates, updateData)
          }
        }
      }
    })

    // Update the episode in the database if there are any updates
    if (Object.keys(allUpdates).length > 0) {
      await updateEpisodeInFlatDB(client, show.title, season.seasonNumber, episode.episodeNumber, {
        $set: allUpdates,
      })
      results.updated = true
    } else {
      results.updated = hasUpdates
    }

    return results
  } catch (error) {
    results.errors.push({ field: 'general', error: error.message })
    return results
  }
}

// Import p-limit for concurrency control
import pLimit from 'p-limit'
import { fetchMetadataMultiServer } from '@src/utils/admin_utils'

/**
 * Traditional sync method for TV episodes
 * @param {Object} client - MongoDB client
 * @param {Object} flatDB - Flat database structure
 * @param {Object} fileServer - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Sync results
 */
async function traditionalSync(client, flatDB, fileServer, serverConfig, fieldAvailability) {
  const results = {
    processed: [],
    errors: [],
    newEpisodes: 0,
  }

  // No file server TV data, nothing to do
  if (!fileServer?.tv) {
    console.log(chalk.yellow(`No TV shows found in file server ${serverConfig.id}`))
    return results
  }

  // Create a concurrency limiter - process up to 120 episodes at a time
  // This prevents overwhelming the database with too many concurrent operations
  const limit = pLimit(120)

  // Create a mapping of titles to TV shows in the database for easy lookup
  const dbShowMap = flatDB.tv.reduce((map, show) => {
    // Also create a mapping of season numbers to seasons for each show
    const seasonMap = show.seasons.reduce((sMap, season) => {
      // Create mapping of episode numbers to episodes for each season
      const episodeMap = season.episodes.reduce((eMap, episode) => {
        eMap[episode.episodeNumber] = episode
        return eMap
      }, {})

      sMap[season.seasonNumber] = {
        season,
        episodes: episodeMap,
      }
      return sMap
    }, {})

    map[show.originalTitle] = {
      show,
      seasons: seasonMap,
    }
    return map
  }, {})

  // Collect all episode sync tasks
  const episodeSyncTasks = []

  // Process each TV show from the file server
  for (const [showTitle, fileServerShowData] of Object.entries(fileServer.tv)) {
    // Skip if no seasons data
    if (!fileServerShowData.seasons) continue

    // Get the show from database or create a simple object with just the title
    const dbShowEntry = dbShowMap[showTitle]
    const show = dbShowEntry?.show || { title: showTitle, originalTitle: showTitle }

    // Check if there are any episodes in the database for this show
    const hasEpisodesInDatabase =
      dbShowEntry &&
      Object.keys(dbShowEntry.seasons).length > 0 &&
      Object.keys(Object.values(dbShowEntry.seasons)[0].episodes).length > 0

    // Process each season from the file server
    for (const [seasonKey, fileServerSeasonData] of Object.entries(fileServerShowData.seasons)) {
      // Skip if no episodes data
      if (!fileServerSeasonData.episodes) continue

      // Extract season number from the key (e.g., "Season 1" -> 1)
      const seasonNumberMatch = seasonKey.match(/Season (\d+)/)
      if (!seasonNumberMatch) continue

      const seasonNumber = parseInt(seasonNumberMatch[1], 10)

      // Get the season from database or create a simple object with basic properties
      const dbSeasonEntry = dbShowEntry?.seasons?.[seasonNumber]
      const season = dbSeasonEntry?.season || {
        seasonNumber,
        showTitle,
      }

      // Get the hash for the season
      const season_hashData = await fetchHashData(serverConfig, 'tv', show.originalTitle, season.seasonNumber);

      // Get all episodes in the file server for this season
      const fileServerEpisodeFileNames = Object.keys(fileServerSeasonData.episodes || {})

      // Process each episode from the file server
      for (const episodeFileName of fileServerEpisodeFileNames) {
        // Extract episode number from filename
        const match = episodeFileName.match(/S\d+E(\d+)/i) || episodeFileName.match(/E(\d+)/i)
        if (!match) continue

        const episodeNumber = parseInt(match[1], 10)

        // Get the episode from database or create a simple object with basic properties
        const dbEpisode = dbSeasonEntry?.episodes?.[episodeNumber]
        const episode = dbEpisode || {
          episodeNumber,
          seasonNumber, // Make sure we include seasonNumber for proper identification
          showTitle, // Make sure we include showTitle for proper identification
        }

        // Process this episode
        episodeSyncTasks.push(
          limit(() =>
            syncSingleEpisode(
              client,
              show,
              season,
              episode,
              fileServerShowData,
              serverConfig,
              fieldAvailability,
              season_hashData,
              false // Do not skip metadata processing
            )
              .then((episodeResults) => {
                if (episodeResults.updated || episodeResults.created) {
                  results.processed.push(episodeResults)
                  if (!dbEpisode) {
                    results.newEpisodes++
                  }
                }
                return episodeResults
              })
              .catch((error) => {
                results.errors.push({
                  showTitle,
                  seasonNumber,
                  episodeNumber,
                  error: error.message,
                })
                return null
              })
          )
        )
      }
    }
  }

  // Log the number of episodes being processed
  console.log(
    chalk.yellow(`Processing ${episodeSyncTasks.length} episodes with max concurrency of 120...`)
  )

  // Execute all tasks in parallel with controlled concurrency
  await Promise.all(episodeSyncTasks)

  return results
}

/**
 * Hash-based sync method for TV episodes
 * @param {Object} client - MongoDB client
 * @param {Object} flatDB - Flat database structure
 * @param {Object} fileServer - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @param {Object} mediaHashData - Media hash data from API
 * @returns {Promise<Object>} Sync results
 */
async function hashBasedSync(
  client,
  flatDB,
  fileServer,
  serverConfig,
  fieldAvailability,
  mediaHashData
) {
  const results = {
    processed: [],
    errors: [],
    skippedShows: 0,
    skippedSeasons: 0,
    skippedEpisodes: 0,
    newEpisodes: 0,
  }

  // No file server TV data, nothing to do
  if (!fileServer?.tv) {
    console.log(chalk.yellow(`No TV shows found in file server ${serverConfig.id}`))
    return results
  }

  // Create a mapping of titles to TV shows in the database for easy lookup
  const dbShowMap = flatDB.tv.reduce((map, show) => {
    // Also create a mapping of season numbers to seasons for each show
    const seasonMap = show.seasons.reduce((sMap, season) => {
      // Create mapping of episode numbers to episodes for each season
      const episodeMap = season.episodes.reduce((eMap, episode) => {
        eMap[episode.episodeNumber] = episode
        return eMap
      }, {})

      sMap[season.seasonNumber] = {
        season,
        episodes: episodeMap,
      }
      return sMap
    }, {})

    map[show.originalTitle] = {
      show,
      seasons: seasonMap,
    }
    return map
  }, {})

  // Process each TV show from the file server
  for (const [showTitle, fileServerShowData] of Object.entries(fileServer.tv)) {
    // Skip shows not in hash data
    if (!mediaHashData.titles[showTitle]) {
      continue
    }

    // Get the show from database or create a simple object with just the title
    const dbShowEntry = dbShowMap[showTitle]
    const show = dbShowEntry?.show || { title: showTitle, originalTitle: showTitle, seasons: [] }

    // Check if show hash has changed
    const currentShowHash = mediaHashData.titles[showTitle].hash
    const storedShowHash = await getStoredHash(client, 'tv', showTitle, null, null, serverConfig.id)

    // Count episodes in database for this show
    const actualEpisodeCount = await client
      .db('Media')
      .collection('FlatEpisodes')
      .countDocuments({ showTitle })

    // Count episodes in file server for this show
    let expectedEpisodeCount = 0

    // Process each season from the file server to count expected episodes
    for (const [seasonKey, fileServerSeasonData] of Object.entries(
      fileServerShowData.seasons || {}
    )) {
      if (fileServerSeasonData && fileServerSeasonData.episodes) {
        expectedEpisodeCount += Object.keys(fileServerSeasonData.episodes)?.length
      }
    }

    // If show hash matches, verify season and episode counts before deciding to skip metadata processing
    // Note: We only use hash matching for metadata, other fields are always processed
    let skipMetadataProcessing = false;
    if (storedShowHash === currentShowHash) {
      // Get the flat database show title (which may be different from the file server show title)
      // The file server showTitle corresponds to originalTitle in the flat database
      const flatShow = await getTVShowFromFlatDB(client, showTitle);
      if (!flatShow) {
        console.log(
          chalk.yellow(
            `Show "${showTitle}" not found in flat database - processing metadata`
          )
        );
        skipMetadataProcessing = false;
      } else {
        const flatShowTitle = flatShow.title;
        
        // Count seasons in the flat database using the correct show title
        const flatSeasonCount = await client
          .db('Media')
          .collection('FlatSeasons')
          .countDocuments({
            showTitle: flatShowTitle
          });
        
        // Count seasons in the file server
        const fileServerSeasonCount = Object.keys(fileServerShowData.seasons || {}).length;
        
        // Count episodes missing metadata using the correct show title
        const missingEpisodeMetadataCount = await client
          .db('Media')
          .collection('FlatEpisodes')
          .countDocuments({
            showTitle: flatShowTitle,
            $or: [{ metadata: { $exists: false } }, { metadata: null }, { metadata: { $size: 0 } }],
          });
        
        // Count episodes in the flat database using the correct show title
        const flatEpisodeCount = await client
          .db('Media')
          .collection('FlatEpisodes')
          .countDocuments({
            showTitle: flatShowTitle
          });

        // Compare season counts, episode counts, and check metadata to decide if we can skip metadata processing
        if (flatSeasonCount >= fileServerSeasonCount && flatEpisodeCount >= expectedEpisodeCount && missingEpisodeMetadataCount === 0) {
          console.log(
            chalk.green(
              `Show "${flatShowTitle}" hash unchanged, all ${flatSeasonCount}/${fileServerSeasonCount} seasons and ${flatEpisodeCount}/${expectedEpisodeCount} episodes exist with metadata - skipping metadata processing only`
            )
          );
          skipMetadataProcessing = true;
        } else if (flatSeasonCount < fileServerSeasonCount) {
          console.log(
            chalk.yellow(
              `Show "${flatShowTitle}" hash unchanged but only ${flatSeasonCount}/${fileServerSeasonCount} seasons exist in flat database - processing metadata`
            )
          );
          skipMetadataProcessing = false;
        } else if (missingEpisodeMetadataCount > 0) {
          console.log(
            chalk.yellow(
              `Show "${flatShowTitle}" hash unchanged but ${missingEpisodeMetadataCount} episodes are missing metadata - processing metadata`
            )
          );
          skipMetadataProcessing = false;
        } else {
          console.log(
            chalk.yellow(
              `Show "${flatShowTitle}" hash unchanged but only ${flatEpisodeCount}/${expectedEpisodeCount} episodes exist - checking for missing episodes`
            )
          );
          skipMetadataProcessing = false;
        }
      }
    }

    // Check for missing episodes in the database
    const missingEpisodesTasks = []

    // First, check if there are any episodes in the database for this show
    // by checking the first season's episodes
    const hasEpisodesInDatabase =
      show.seasons?.length > 0 && show.seasons[0].episodes && show.seasons[0].episodes?.length > 0

    // Process each season to find missing episodes
    for (const season of show.seasons) {
      const seasonNumber = season.seasonNumber
      const seasonKey = `Season ${seasonNumber}`
      const fileServerSeasonData = fileServerShowData?.seasons?.[seasonKey]

      if (!fileServerSeasonData) continue

      // Get the hash for the season
      const season_hashData = await fetchHashData(serverConfig, 'tv', show.originalTitle, seasonNumber);

      // Get all episodes in the file server for this season
      const fileServerEpisodeFileNames = Object.keys(fileServerSeasonData.episodes || {})

      // If there are no episodes in the database for this show, process all episodes from file server
      if (!hasEpisodesInDatabase) {
        console.log(
          chalk.yellow(
            `No episodes found in database for "${showTitle}" - processing all episodes from file server`
          )
        )

        for (const episodeFileName of fileServerEpisodeFileNames) {
          // Extract episode number from filename
          const match = episodeFileName.match(/S\d+E(\d+)/i) || episodeFileName.match(/E(\d+)/i)
          if (!match) continue

          const episodeNumber = parseInt(match[1], 10)

          console.log(
            chalk.yellow(`Processing episode: "${showTitle}" S${seasonNumber}E${episodeNumber}`)
          )

          // Create a temporary episode object with all necessary identifiers
          const tempEpisode = {
            episodeNumber,
            seasonNumber: season.seasonNumber,
            showTitle: show.title,
          }

          // Process this episode
          missingEpisodesTasks.push(
            syncSingleEpisode(
              client,
              show,
              season,
              tempEpisode,
              fileServerShowData,
              serverConfig,
              fieldAvailability,
              season_hashData,
              skipMetadataProcessing,
            )
              .then((episodeResults) => {
                if (episodeResults.updated || episodeResults.created) {
                  results.processed.push(episodeResults)
                  results.newEpisodes++
                }
                return episodeResults
              })
              .catch((error) => {
                results.errors.push({
                  showTitle: show.title,
                  seasonNumber: season.seasonNumber,
                  episodeNumber: episodeNumber,
                  error: error.message,
                })
                return null
              })
          )
        }
      } else {
        // Create a set of episode numbers that exist in the database for this season
        const existingEpisodeNumbers = new Set(season.episodes.map((e) => e.episodeNumber))

        // Also check which of the existing episodes might be missing metadata
        const existingEpisodesWithoutMetadata = new Map()

        // For each existing episode, check if it has metadata
        for (const episode of season.episodes) {
          const flatEpisode = await getEpisodeFromFlatDB(
            client,
            showTitle,
            seasonNumber,
            episode.episodeNumber,
            true
          )
          // Add to map if episode exists but metadata is missing or empty
          if (
            flatEpisode &&
            (!flatEpisode.metadata || Object.keys(flatEpisode.metadata).length === 0)
          ) {
            existingEpisodesWithoutMetadata.set(episode.episodeNumber, flatEpisode)
            console.log(
              chalk.yellow(
                `Found existing episode without metadata: "${showTitle}" S${seasonNumber}E${episode.episodeNumber}`
              )
            )
          }
        }

        // For each episode in the file server, check if it exists in the database
        for (const episodeFileName of fileServerEpisodeFileNames) {
          // Extract episode number from filename
          const match = episodeFileName.match(/S\d+E(\d+)/i) || episodeFileName.match(/E(\d+)/i)
          if (!match) continue

          const episodeNumber = parseInt(match[1], 10)

          // Check if this episode exists in the database but is missing metadata
          if (existingEpisodesWithoutMetadata.has(episodeNumber)) {
            console.log(
              chalk.yellow(
                `Processing existing episode without metadata: "${showTitle}" S${seasonNumber}E${episodeNumber}`
              )
            )

            // Get the existing episode
            const existingEpisode = existingEpisodesWithoutMetadata.get(episodeNumber)

            // Process this episode
            missingEpisodesTasks.push(
              syncSingleEpisode(
                client,
                show,
                season,
                existingEpisode,
                fileServerShowData,
                serverConfig,
                fieldAvailability,
                season_hashData,
                skipMetadataProcessing
              )
                .then((episodeResults) => {
                  if (episodeResults.updated) {
                    results.processed.push(episodeResults)
                  }
                  return episodeResults
                })
                .catch((error) => {
                  results.errors.push({
                    showTitle: show.title,
                    seasonNumber: season.seasonNumber,
                    episodeNumber: episodeNumber,
                    error: error.message,
                  })
                  return null
                })
            )
          }
          // Check if this episode doesn't exist in the database at all
          else if (!existingEpisodeNumbers.has(episodeNumber)) {
            console.log(
              chalk.yellow(
                `Found missing episode: "${showTitle}" S${seasonNumber}E${episodeNumber}`
              )
            )

            // Create a temporary episode object with all necessary identifiers
            const tempEpisode = {
              episodeNumber,
              seasonNumber: season.seasonNumber,
              showTitle: show.title,
            }

            // Process this episode
            missingEpisodesTasks.push(
              syncSingleEpisode(
                client,
                show,
                season,
                tempEpisode,
                fileServerShowData,
                serverConfig,
                fieldAvailability,
                season_hashData,
                skipMetadataProcessing
              )
                .then((episodeResults) => {
                  if (episodeResults.updated || episodeResults.created) {
                    results.processed.push(episodeResults)
                    results.newEpisodes++
                  }
                  return episodeResults
                })
                .catch((error) => {
                  results.errors.push({
                    showTitle: show.title,
                    seasonNumber: season.seasonNumber,
                    episodeNumber: episodeNumber,
                    error: error.message,
                  })
                  return null
                })
            )
          }
        }
      }
    }

    // Process any missing episodes
    if (missingEpisodesTasks?.length > 0) {
      console.log(
        chalk.yellow(
          `Processing ${missingEpisodesTasks?.length} missing episodes for "${showTitle}"`
        )
      )
      await Promise.all(missingEpisodesTasks)
    }

    // Process metadata only if needed
    let metadataResults = { updated: 0, unchanged: 0, errors: 0 };
    
    if (!skipMetadataProcessing) {
      // Use the batch metadata sync function for this show
      metadataResults = await syncShowEpisodesMetadataWithHashes(
        client,
        show,
        show.seasons,
        fileServerShowData,
        serverConfig,
        fieldAvailability,
        storedShowHash
      );
    } else {
      console.log(
        chalk.cyan(
          `Skipping metadata processing for "${showTitle}" due to hash match - other fields will still be processed`
        )
      );
      results.skippedEpisodes += show.seasons.reduce(
        (count, season) => count + (season.episodes?.length || 0),
        0
      );
    }
    
    // Process all episodes to update non-metadata fields
    // This ensures fields like videoURL, video info, captions, etc. are always updated
    // regardless of metadata hash match
    const nonMetadataTasks = [];
    const limit = pLimit(20);
    
    // Process each season
    for (const season of show.seasons) {
      const seasonNumber = season.seasonNumber;
      const seasonKey = `Season ${seasonNumber}`;
      const fileServerSeasonData = fileServerShowData?.seasons?.[seasonKey];
      
      if (!fileServerSeasonData || !fileServerSeasonData.episodes) continue;

      // Get the hash for the season
      const season_hashData = await fetchHashData(serverConfig, 'tv', show.originalTitle, seasonNumber);
      
      // Process each episode in this season
      for (const episode of season.episodes) {
        // Find the episode file name in the file server data
        const episodeFileName = findEpisodeFileName(
          Object.keys(fileServerSeasonData.episodes || {}),
          seasonNumber,
          episode.episodeNumber
        );
        
        // Skip if episode not found in file server
        if (!episodeFileName) continue;
        
        // Process this episode using the existing syncSingleEpisode function
        // which already handles all fields including non-metadata ones
        nonMetadataTasks.push(
          limit(() => 
            syncSingleEpisode(
              client,
              show,
              season,
              episode,
              fileServerShowData,
              serverConfig,
              fieldAvailability,
              season_hashData,
              skipMetadataProcessing
            )
            .then((episodeResults) => {
              if (episodeResults.updated) {
                // Only add to results if fields other than metadata were updated
                const nonMetadataFields = episodeResults.fields.filter(f => f !== 'metadata');
                if (nonMetadataFields.length > 0) {
                  console.log(
                    chalk.green(
                      `Updated non-metadata fields for "${show.title}" S${seasonNumber}E${episode.episodeNumber}: ${nonMetadataFields.join(', ')}`
                    )
                  );
                  results.processed.push({
                    ...episodeResults,
                    fields: nonMetadataFields
                  });
                }
              }
              return episodeResults;
            })
            .catch((error) => {
              results.errors.push({
                showTitle: show.title,
                seasonNumber,
                episodeNumber: episode.episodeNumber,
                error: error.message,
              });
              return null;
            })
          )
        );
      }
    }
    
    // Process all non-metadata tasks
    if (nonMetadataTasks.length > 0) {
      console.log(
        chalk.yellow(
          `Processing non-metadata fields for ${nonMetadataTasks.length} episodes of "${show.title}"`
        )
      );
      await Promise.all(nonMetadataTasks);
    }

    // Update results
    results.skippedEpisodes += metadataResults.unchanged

    if (metadataResults.updated > 0) {
      results.processed.push({
        showTitle,
        updated: true,
        fields: ['metadata'],
        episodesUpdated: metadataResults.updated,
      })
    }

    if (metadataResults.errors > 0) {
      results.errors.push({
        showTitle,
        error: `${metadataResults.errors} episodes had errors during metadata sync`,
      })
    }

    // Store the show hash for future reference
    await storeHash(client, 'tv', showTitle, null, null, currentShowHash, serverConfig.id)
  }

  return results
}

/**
 * Counts expected episodes for a server based on file server data
 * @param {Object} fileServer - File server data
 * @returns {number} Total expected episode count
 */
function countExpectedEpisodesForServer(fileServer) {
  let totalExpectedEpisodes = 0
  const serverShowTitles = Object.keys(fileServer.tv || {})
  
  for (const showTitle of serverShowTitles) {
    const showData = fileServer.tv[showTitle]
    if (!showData?.seasons) continue

    for (const seasonKey of Object.keys(showData.seasons)) {
      const seasonData = showData.seasons[seasonKey]
      if (!seasonData?.episodes) continue

      for (const episodeKey of Object.keys(seasonData.episodes)) {
        const episodeData = seasonData.episodes[episodeKey]
        // Video URLs are critical for episode processing
        // If a video URL is missing, we can't process the episode so omit it from the count
        if (episodeData?.videoURL) {
          totalExpectedEpisodes++
        }
      }
    }
  }
  
  return totalExpectedEpisodes
}

/**
 * Log sync results in a consistent format
 * @param {Object} results - Sync results
 * @param {string} serverId - Server ID
 * @param {string} syncStrategy - Sync strategy used
 */
function logSyncResults(results, serverId, syncStrategy) {
  console.log(chalk.bold.cyan(`TV episode sync to flat structure complete for server ${serverId}`))
  
  if (syncStrategy === 'hash-based') {
    console.log(chalk.green(`Successfully processed ${results.processed?.length || 0} shows/episodes`))
    console.log(
      chalk.cyan(
        `Skipped ${results.skippedShows || 0} shows, ${results.skippedSeasons || 0} seasons, and ${results.skippedEpisodes || 0} episodes due to hash matches`
      )
    )
  } else {
    console.log(chalk.green(`Successfully processed ${results.processed?.length || 0} episodes`))
  }
  
  if (results.newEpisodes > 0) {
    console.log(
      chalk.yellow(
        `Added ${results.newEpisodes} new episodes that were missing from the database`
      )
    )
  }
  
  if (results.errors?.length > 0) {
    console.log(chalk.red(`Encountered ${results.errors?.length} errors during episode sync`))
  }
}

/**
 * Syncs TV episodes from file server to flat database structure
 * @param {Object} flatDB - Flat database structure
 * @param {Object} fileServer - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Sync results
 */
export async function syncEpisodes(flatDB, fileServer, serverConfig, fieldAvailability) {
  const client = await clientPromise
  console.log(
    chalk.bold.cyan(`Starting TV episode sync to flat structure for server ${serverConfig.id}...`)
  )

  try {
    // 1. First, validate we have episodes to process
    const totalExpectedEpisodes = countExpectedEpisodesForServer(fileServer)
    
    if (totalExpectedEpisodes === 0) {
      console.log(chalk.yellow(`No episodes found in fileserver for ${serverConfig.id} - skipping episode sync`))
      return { processed: [], errors: [], skipped: true }
    }
    
    // 2. Determine sync strategy - hash-based or traditional
    let syncStrategy = 'traditional'
    let mediaHashResponse = null
    
    try {
      // Try to get hash data from server
      mediaHashResponse = await fetchHashData(serverConfig, 'tv')
      
      if (mediaHashResponse) {
        console.log(chalk.cyan('Using hash-based sync for TV episodes'))
        syncStrategy = 'hash-based'
      }
    } catch (hashError) {
      console.warn(chalk.yellow('Hash-based sync failed, falling back to traditional sync:'), hashError.message)
    }
    
    // 3. If using hash-based sync, check server-specific episode count
    if (syncStrategy === 'hash-based') {
      // Count episodes with this server as the source
      const episodesWithSourceCount = await client
        .db('Media')
        .collection('FlatEpisodes')
        .countDocuments({ videoSource: serverConfig.id })

      console.log(
        chalk.cyan(`Found ${episodesWithSourceCount} episodes with source = ${serverConfig.id}`)
      )
      console.log(
        chalk.cyan(`Server ${serverConfig.id} should have ${totalExpectedEpisodes} episodes`)
      )

      // Get the hash specifically for this server
      const storedMediaHash = await getStoredHash(client, 'tv', null, null, null, serverConfig.id)
      
      // Create a flag for metadata optimization but NEVER skip the entire sync process
      const serverHasAllEpisodes = episodesWithSourceCount >= totalExpectedEpisodes
      const canOptimizeMetadata = storedMediaHash === mediaHashResponse.hash

      // Log status but always continue processing
      if (canOptimizeMetadata && serverHasAllEpisodes) {
        console.log(
          chalk.cyan(
            `Hash match for server ${serverConfig.id} - will optimize metadata requests but still process episodes`
          )
        )
      } else if (canOptimizeMetadata && !serverHasAllEpisodes) {
        console.log(
          chalk.yellow(
            `Hash match but missing episodes for server ${serverConfig.id} (${episodesWithSourceCount}/${totalExpectedEpisodes}) - processing all episodes`
          )
        )
      } else {
        console.log(
          chalk.cyan(
            `Hash mismatch or first sync - processing TV episodes for server ${serverConfig.id}`
          )
        )
      }
    } else {
      console.log(chalk.yellow('Using traditional sync for TV episodes'))
    }
    
    // 4. Execute the appropriate sync strategy
    let results
    if (syncStrategy === 'hash-based') {
      results = await hashBasedSync(
        client,
        flatDB,
        fileServer,
        serverConfig,
        fieldAvailability,
        mediaHashResponse
      )

      // Store the new top-level hash with server ID
      await storeHash(client, 'tv', null, null, null, mediaHashResponse.hash, serverConfig.id)
    } else {
      results = await traditionalSync(
        client,
        flatDB,
        fileServer,
        serverConfig,
        fieldAvailability
      )
    }
    
    // 5. Log results in a consistent format
    logSyncResults(results, serverConfig.id, syncStrategy)
    
    return results
  } catch (error) {
    console.error(
      `Error during TV episode sync to flat structure for server ${serverConfig.id}:`,
      error
    )
    return {
      processed: [],
      errors: [
        {
          general: true,
          error: error.message,
        },
      ],
    }
  }
}
