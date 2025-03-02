import { MediaType, findEpisodeFileName } from './utils'
import clientPromise from '@src/lib/mongodb'
import { getRedisClient } from '@src/lib/redisClient'
import chalk from 'chalk'

/**
 * Checks if a movie is available on any file server.
 * @param {string} movieTitle - Movie title
 * @param {Object} fileServers - All file servers data
 * @returns {boolean} True if available on any server
 */
export function isMovieAvailableOnAnyServer(movieTitle, fileServers) {
  // Check each server for this movie's video URL
  return Object.values(fileServers).some(fileServer => {
    const movieData = fileServer.movies?.[movieTitle]
    return movieData?.urls?.mp4 ? true : false
  })
}

/**
 * Checks if a TV episode is available on any file server.
 * @param {string} showTitle - Show title
 * @param {number} seasonNumber - Season number
 * @param {number} episodeNumber - Episode number
 * @param {Object} fileServers - All file servers data
 * @returns {boolean} True if available on any server
 */
export function isEpisodeAvailableOnAnyServer(showTitle, seasonNumber, episodeNumber, fileServers) {
  // Check each server for this episode's video URL
  return Object.values(fileServers).some(fileServer => {
    const showData = fileServer.tv?.[showTitle]
    if (!showData) return false
    
    const seasonKey = `Season ${seasonNumber}`
    const seasonData = showData.seasons?.[seasonKey]
    if (!seasonData?.episodes) return false
    
    // Find the episode file
    const episodeFileName = findEpisodeFileName(
      Object.keys(seasonData.episodes),
      seasonNumber,
      episodeNumber
    )
    
    if (!episodeFileName) return false
    
    // Check if the episode has a video URL
    return seasonData.episodes[episodeFileName]?.videoURL ? true : false
  })
}

/**
 * Gathers unavailable movies across all file servers.
 * @param {Object} currentDB - Current database state
 * @param {Object} fileServers - All file servers data
 * @returns {Array<string>} Array of movie titles that are unavailable
 */
export function gatherUnavailableMovies(currentDB, fileServers) {
  const unavailableMovies = []
  
  for (const movie of currentDB.movies) {
    if (!isMovieAvailableOnAnyServer(movie.title, fileServers)) {
      unavailableMovies.push(movie.title)
    }
  }
  
  return unavailableMovies
}

/**
 * Gathers unavailable TV content across all file servers.
 * @param {Object} currentDB - Current database state
 * @param {Object} fileServers - All file servers data
 * @returns {Object} Object containing unavailable episodes, seasons, and shows
 */
export function gatherUnavailableTVContent(currentDB, fileServers) {
  const result = {
    unavailableEpisodes: [], // Individual episodes to remove
    unavailableSeasons: [],  // Entire seasons to remove
    unavailableShows: []     // Entire shows to remove
  }
  
  for (const show of currentDB.tv) {
    let showHasAvailableSeasons = false;
    
    // Check if the show has any seasons at all
    if (show.seasons.length === 0) {
      // Show has no seasons, mark it for removal
      result.unavailableShows.push(show.title);
      console.log(`Show "${show.title}" has no seasons and should be removed`);
      continue; // Skip to the next show
    }
    
    // Process each season
    for (const season of show.seasons) {
      let seasonHasAvailableEpisodes = false;
      let unavailableEpisodesInSeason = [];
      
      // Check if the season has any episodes
      if (season.episodes.length === 0) {
        // Season has no episodes, mark it for removal
        result.unavailableSeasons.push({
          showTitle: show.title,
          seasonNumber: season.seasonNumber
        });
        console.log(`Season ${season.seasonNumber} of "${show.title}" has no episodes and should be removed`);
        continue; // Skip to the next season
      }
      
      // Check each episode in the season
      for (const episode of season.episodes) {
        if (!isEpisodeAvailableOnAnyServer(
          show.title, 
          season.seasonNumber, 
          episode.episodeNumber, 
          fileServers
        )) {
          // This episode is unavailable
          unavailableEpisodesInSeason.push({
            showTitle: show.title,
            seasonNumber: season.seasonNumber,
            episodeNumber: episode.episodeNumber
          });
        } else {
          // This episode is available
          seasonHasAvailableEpisodes = true;
          showHasAvailableSeasons = true;
        }
      }
      
      if (!seasonHasAvailableEpisodes) {
        // If the season has no available episodes, mark the entire season for removal
        result.unavailableSeasons.push({
          showTitle: show.title,
          seasonNumber: season.seasonNumber
        });
        console.log(`All episodes in season ${season.seasonNumber} of "${show.title}" are unavailable`);
      } else {
        // Season has some available episodes, so add individual unavailable episodes
        result.unavailableEpisodes.push(...unavailableEpisodesInSeason);
      }
    }
    
    // If the show has no available seasons, mark the entire show for removal
    if (!showHasAvailableSeasons) {
      result.unavailableShows.push(show.title);
      console.log(`All seasons of "${show.title}" are unavailable`);
    }
  }
  
  return result;
}

/**
 * Checks video availability across all file servers and returns records to remove.
 * @param {Object} currentDB - Current database state
 * @param {Object} fileServers - All file servers data
 * @returns {Object} Records to remove from database
 */
export async function checkVideoAvailabilityAcrossServers(currentDB, fileServers) {
  console.log(chalk.bold.red(`Starting video availability check across all servers...`))
  
  // Return structure
  const recordsToRemove = {
    movies: [],       // Array of movie titles to remove
    tvShows: [],      // Array of TV show titles to remove
    tvSeasons: [],    // Array of {showTitle, seasonNumber} objects
    tvEpisodes: []    // Array of {showTitle, seasonNumber, episodeNumber} objects
  }
  
  try {
    // Gather unavailable videos
    recordsToRemove.movies = gatherUnavailableMovies(currentDB, fileServers)
    
    // Gather unavailable TV content
    const tvResult = gatherUnavailableTVContent(currentDB, fileServers)
    recordsToRemove.tvEpisodes = tvResult.unavailableEpisodes
    recordsToRemove.tvSeasons = tvResult.unavailableSeasons
    recordsToRemove.tvShows = tvResult.unavailableShows
    
    // Log results
    if (recordsToRemove.movies.length > 0) {
      console.log(chalk.yellow(`Found ${recordsToRemove.movies.length} movies unavailable across all servers`))
    }
    
    if (recordsToRemove.tvShows.length > 0) {
      console.log(chalk.yellow(`Found ${recordsToRemove.tvShows.length} TV shows with no available content`))
    }
    
    if (recordsToRemove.tvSeasons.length > 0) {
      console.log(chalk.yellow(`Found ${recordsToRemove.tvSeasons.length} TV seasons with no available episodes`))
    }
    
    if (recordsToRemove.tvEpisodes.length > 0) {
      console.log(chalk.yellow(`Found ${recordsToRemove.tvEpisodes.length} individual TV episodes unavailable`))
    }
    
    console.log(chalk.bold.red(`Video availability check complete`))
    return recordsToRemove
  } catch (error) {
    console.error(`Error during video availability check:`, error)
    // Instead of throwing the error, add it to the results and return
    recordsToRemove.error = {
      message: error.message,
      stack: error.stack
    }
    return recordsToRemove
  }
}

/**
 * Clears Redis cache entries related to removed content.
 * @param {Object} recordsToRemove - Records being removed
 * @returns {Promise<Object>} Cache clearing results
 */
export async function clearRelatedCacheEntries(recordsToRemove) {
  const redisClient = await getRedisClient()
  if (!redisClient) {
    console.log('Redis not configured. Skipping cache clearing.')
    return { cleared: 0, errors: 0 }
  }
  
  const results = {
    cleared: 0,
    errors: 0,
    details: []
  }
  
  try {
    console.log(chalk.bold.blue(`Clearing Redis cache entries for removed content...`))
    
    // Clear cache for movies
    for (const movieTitle of recordsToRemove.movies) {
      try {
        // Common cache key patterns for movies
        const movieCacheKeys = [
          `movie:${movieTitle}*`,
          `metadata:movie:${movieTitle}*`,
          `blurhash:movie:${movieTitle}*`,
          `poster:movie:${movieTitle}*`,
          `backdrop:movie:${movieTitle}*`
        ]
        
        for (const pattern of movieCacheKeys) {
          const keys = await redisClient.keys(pattern)
          if (keys.length > 0) {
            await redisClient.del(keys)
            results.cleared += keys.length
            results.details.push(`Cleared ${keys.length} cache entries for movie "${movieTitle}" with pattern ${pattern}`)
          }
        }
      } catch (error) {
        console.error(`Error clearing cache for movie "${movieTitle}":`, error)
        results.errors++
      }
    }
    
    // Clear cache for TV shows
    for (const showTitle of recordsToRemove.tvShows) {
      try {
        // Common cache key patterns for TV shows
        const showCacheKeys = [
          `tv:${showTitle}*`,
          `metadata:tv:${showTitle}*`,
          `blurhash:tv:${showTitle}*`,
          `poster:tv:${showTitle}*`,
          `backdrop:tv:${showTitle}*`,
          `season:${showTitle}*`,
          `episode:${showTitle}*`
        ]
        
        for (const pattern of showCacheKeys) {
          const keys = await redisClient.keys(pattern)
          if (keys.length > 0) {
            await redisClient.del(keys)
            results.cleared += keys.length
            results.details.push(`Cleared ${keys.length} cache entries for TV show "${showTitle}" with pattern ${pattern}`)
          }
        }
      } catch (error) {
        console.error(`Error clearing cache for TV show "${showTitle}":`, error)
        results.errors++
      }
    }
    
    // Clear cache for TV seasons
    for (const { showTitle, seasonNumber } of recordsToRemove.tvSeasons) {
      try {
        // Skip if the entire show is being removed (already handled above)
        if (recordsToRemove.tvShows.includes(showTitle)) continue
        
        // Common cache key patterns for seasons
        const seasonCacheKeys = [
          `season:${showTitle}:${seasonNumber}*`,
          `metadata:season:${showTitle}:${seasonNumber}*`,
          `blurhash:season:${showTitle}:${seasonNumber}*`,
          `poster:season:${showTitle}:${seasonNumber}*`
        ]
        
        for (const pattern of seasonCacheKeys) {
          const keys = await redisClient.keys(pattern)
          if (keys.length > 0) {
            await redisClient.del(keys)
            results.cleared += keys.length
            results.details.push(`Cleared ${keys.length} cache entries for season ${seasonNumber} of "${showTitle}" with pattern ${pattern}`)
          }
        }
      } catch (error) {
        console.error(`Error clearing cache for season ${seasonNumber} of "${showTitle}":`, error)
        results.errors++
      }
    }
    
    // Clear cache for TV episodes
    for (const { showTitle, seasonNumber, episodeNumber } of recordsToRemove.tvEpisodes) {
      try {
        // Skip if the entire show or season is being removed (already handled above)
        if (recordsToRemove.tvShows.includes(showTitle)) continue
        if (recordsToRemove.tvSeasons.some(s => s.showTitle === showTitle && s.seasonNumber === seasonNumber)) continue
        
        // Common cache key patterns for episodes
        const episodeCacheKeys = [
          `episode:${showTitle}:${seasonNumber}:${episodeNumber}*`,
          `metadata:episode:${showTitle}:${seasonNumber}:${episodeNumber}*`,
          `thumbnail:episode:${showTitle}:${seasonNumber}:${episodeNumber}*`,
          `blurhash:episode:${showTitle}:${seasonNumber}:${episodeNumber}*`
        ]
        
        for (const pattern of episodeCacheKeys) {
          const keys = await redisClient.keys(pattern)
          if (keys.length > 0) {
            await redisClient.del(keys)
            results.cleared += keys.length
            results.details.push(`Cleared ${keys.length} cache entries for episode ${episodeNumber} of season ${seasonNumber} of "${showTitle}" with pattern ${pattern}`)
          }
        }
      } catch (error) {
        console.error(`Error clearing cache for episode ${episodeNumber} of season ${seasonNumber} of "${showTitle}":`, error)
        results.errors++
      }
    }
    
    console.log(chalk.bold.blue(`Cache clearing complete. Cleared ${results.cleared} entries with ${results.errors} errors.`))
    return results
  } catch (error) {
    console.error(`Error during cache clearing:`, error)
    return { cleared: 0, errors: 1, details: [error.message] }
  }
}

/**
 * Removes unavailable videos from the database.
 * @param {Object} recordsToRemove - Records to remove
 * @returns {Promise<Object>} Removal results
 */
export async function removeUnavailableVideos(recordsToRemove) {
  const client = await clientPromise
  console.log(chalk.bold.red(`Starting removal of unavailable videos...`))
  
  const results = {
    removed: { 
      movies: [], 
      tvShows: [], 
      tvSeasons: [], 
      tvEpisodes: [] 
    },
    errors: { 
      movies: [], 
      tvShows: [], 
      tvSeasons: [], 
      tvEpisodes: [] 
    },
    cache: null
  }
  
  try {
    // 1. Remove entire TV shows first
    if (recordsToRemove.tvShows && recordsToRemove.tvShows.length > 0) {
      await Promise.allSettled(
        recordsToRemove.tvShows.map(async (showTitle) => {
          try {
            const result = await client.db('Media').collection('TV').deleteOne({ title: showTitle })
            if (result.deletedCount > 0) {
              console.log(`Successfully removed entire TV show "${showTitle}"`)
              results.removed.tvShows.push(showTitle)
            } else {
              console.log(`No TV show found with title "${showTitle}"`)
            }
          } catch (error) {
            console.error(`Error removing TV show "${showTitle}":`, error)
            results.errors.tvShows.push({
              title: showTitle,
              error: error.message
            })
          }
        })
      )
    }
    
    // 2. Remove entire seasons (but only for shows that aren't being entirely removed)
    const seasonsToProcess = recordsToRemove.tvSeasons.filter(
      season => !recordsToRemove.tvShows.includes(season.showTitle)
    )
    
    if (seasonsToProcess.length > 0) {
      await Promise.allSettled(
        seasonsToProcess.map(async ({ showTitle, seasonNumber }) => {
          try {
            // Pull the entire season from the seasons array
            const result = await client.db('Media').collection('TV').updateOne(
              { title: showTitle },
              { 
                $pull: { 
                  "seasons": { seasonNumber: seasonNumber } 
                } 
              }
            )
            
            if (result.modifiedCount > 0) {
              console.log(`Successfully removed entire season ${seasonNumber} from "${showTitle}"`)
              results.removed.tvSeasons.push({ showTitle, seasonNumber })
            } else {
              console.log(`No changes made when removing season ${seasonNumber} from "${showTitle}"`)
            }
          } catch (error) {
            console.error(`Error removing season ${seasonNumber} from "${showTitle}":`, error)
            results.errors.tvSeasons.push({
              showTitle,
              seasonNumber,
              error: error.message
            })
          }
        })
      )
    }
    
    // 3. Remove individual episodes (only for seasons that aren't being entirely removed)
    const episodesToProcess = recordsToRemove.tvEpisodes.filter(episode => {
      // Skip if the show is being removed
      if (recordsToRemove.tvShows.includes(episode.showTitle)) return false
      
      // Skip if the season is being removed
      const seasonBeingRemoved = recordsToRemove.tvSeasons.some(
        season => season.showTitle === episode.showTitle && season.seasonNumber === episode.seasonNumber
      )
      return !seasonBeingRemoved
    })
    
    if (episodesToProcess.length > 0) {
      await Promise.allSettled(
        episodesToProcess.map(async ({ showTitle, seasonNumber, episodeNumber }) => {
          try {
            // Use MongoDB's arrayFilters to target the specific season and remove the episode
            const result = await client.db('Media').collection('TV').updateOne(
              { title: showTitle },
              { 
                $pull: { 
                  "seasons.$[season].episodes": { episodeNumber: episodeNumber } 
                } 
              },
              { 
                arrayFilters: [{ "season.seasonNumber": seasonNumber }] 
              }
            )
            
            if (result.modifiedCount > 0) {
              console.log(`Successfully removed episode ${episodeNumber} from season ${seasonNumber} of "${showTitle}"`)
              results.removed.tvEpisodes.push({ showTitle, seasonNumber, episodeNumber })
            } else {
              console.log(`No changes made when removing episode ${episodeNumber} from season ${seasonNumber} of "${showTitle}"`)
            }
          } catch (error) {
            console.error(`Error removing episode ${episodeNumber} from season ${seasonNumber} of "${showTitle}":`, error)
            results.errors.tvEpisodes.push({
              showTitle,
              seasonNumber,
              episodeNumber,
              error: error.message
            })
          }
        })
      )
    }
    
    // 4. Remove movies
    if (recordsToRemove.movies.length > 0) {
      await Promise.allSettled(
        recordsToRemove.movies.map(async (movieTitle) => {
          try {
            const result = await client.db('Media').collection('Movies').deleteOne({ title: movieTitle })
            if (result.deletedCount > 0) {
              console.log(`Successfully removed movie "${movieTitle}"`)
              results.removed.movies.push(movieTitle)
            } else {
              console.log(`No movie found with title "${movieTitle}"`)
            }
          } catch (error) {
            console.error(`Error removing movie "${movieTitle}":`, error)
            results.errors.movies.push({
              title: movieTitle,
              error: error.message
            })
          }
        })
      )
    }
    
    // Clear related cache entries
    results.cache = await clearRelatedCacheEntries(recordsToRemove)
    
    console.log(chalk.bold.red(`Removal of unavailable videos complete`))
    return results
  } catch (error) {
    console.error(`Error during removal of unavailable videos:`, error)
    // Instead of throwing the error, add it to the results and return
    results.errors.general = {
      message: error.message,
      stack: error.stack
    }
    return results
  }
}
