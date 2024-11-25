'use server'

import clientPromise from '@src/lib/mongodb'
import { fetchMetadataMultiServer } from '@src/utils/admin_utils'
import { matchEpisodeFileName, processMovie, processMovieCaptions, processMovieChapters, processMovieLogo, processMovieMetadata, processMovieVideoURL, processSeasonCaptions, processSeasonChapters, processSeasonMetadata, processSeasonVideoURLs, processShowLogo, processTVShow, updateMediaInDatabase, extractEpisodeDetails, processShowBlurhash, processMovieBlurhash, processSeasonVideoInfo, processMovieVideoInfo, findEpisodeFileName, processEpisodeThumbnails, updateEpisodeInDatabase, processSeasonPoster, processPosterURL, MediaType, processBackdropURLs, processBackdropUpdates, processSeasonThumbnails, processSeasonPosters, processShowPosterURL } from '@src/utils/sync_utils'
import chalk from 'chalk'

/**
 * Identifies missing media and MP4 files between the file server and current database.
 * @param {Object} fileServer - The data structure representing media available on the file server.
 * @param {Object} currentDB - The current state of the media database.
 * @returns {Object} An object containing arrays of missing media and MP4 file information.
 */
export async function identifyMissingMedia(fileServer, currentDB) {
  const missingMedia = { tv: [], movies: [] }
  const missingShowsMap = new Map()

  // Keep track of titles (movie/tv) that don't have a url for the mp4 file
  const missingMp4 = { tv: [], movies: [] }

  // Check for missing TV shows, seasons, and episodes
  Object.keys(fileServer?.tv).forEach((showTitle) => {
    const foundShow = currentDB.tv.find((show) => show.title === showTitle)

    if (!foundShow) {
      const seasons = Object.keys(fileServer?.tv[showTitle].seasons)
      const seasonsWithEpisodes = seasons.filter(
        (season) => fileServer?.tv[showTitle].seasons[season].fileNames.length > 0
      )

      if (seasonsWithEpisodes.length > 0) {
        missingShowsMap.set(showTitle, {
          showTitle,
          seasons: seasonsWithEpisodes,
        })
      } else {
        // If there are no seasons with episodes, add the show to missingMp4.tv
        missingMp4.tv.push(showTitle)
      }
    } else {
      Object.keys(fileServer?.tv[showTitle].seasons).forEach((season) => {
        const foundSeason = foundShow.seasons.find((s) => `Season ${s.seasonNumber}` === season)
        const hasFilesForSeason =
          Array.isArray(foundSeason?.fileNames) ||
          foundSeason?.fileNames?.length > 0 ||
          fileServer?.tv[showTitle].seasons[season]?.fileNames?.length > 0

        if (!foundSeason && hasFilesForSeason) {
          let show = missingShowsMap.get(showTitle) || { showTitle, seasons: [] }
          show.seasons.push(season)
          missingShowsMap.set(showTitle, show)
        } else if (hasFilesForSeason) {
          const seasonFiles = fileServer?.tv[showTitle].seasons[season].fileNames

          // Check if the season has any episodes
          if (seasonFiles.length === 0) {
            missingMp4.tv.push(`${showTitle} - ${season}`)
          } else {
            const missingEpisodes = seasonFiles
              .filter((episodeFileName) => {
                /**
                 * Checks if the given episode file name matches the expected format
                 * and returns whether that episode already exists for the given season
                 */
                const match = matchEpisodeFileName(episodeFileName)
                if (match) {
                  const details = extractEpisodeDetails(match)
                  return !foundSeason.episodes.some(
                    (e) => e.episodeNumber === details.episodeNumber
                  )
                }

                return false
              })
              .map((episodeFileName) => {
                const length = fileServer?.tv[showTitle].seasons[season].lengths[episodeFileName]
                const dimensions =
                  fileServer?.tv[showTitle].seasons[season].dimensions[episodeFileName]
                const urls = fileServer?.tv[showTitle].seasons[season].urls[episodeFileName]
                return { episodeFileName, length, dimensions, ...urls }
              })

            if (missingEpisodes.length > 0) {
              let show = missingShowsMap.get(showTitle) || { showTitle, seasons: [] }
              show.seasons.push({ season, missingEpisodes })
              missingShowsMap.set(showTitle, show)
            }
          }
        }
      })
    }
  })

  // Convert Map to Array
  const missingMediaArray = Array.from(missingShowsMap.values())
  missingMedia.tv = missingMediaArray

  // Check for missing Movies
  Object.keys(fileServer?.movies).forEach((movieTitle) => {
    const foundMovie = currentDB.movies.find((movie) => movie.title === movieTitle)
    if (!foundMovie) {
      // If the movie is missing the url for the mp4 file
      // Add it to the missingMedia array
      if (fileServer?.movies[movieTitle].urls.mp4) {
        missingMedia.movies.push(movieTitle)
      } else {
        missingMp4.movies.push(movieTitle)
      }
    }
  })

  return { missingMedia, missingMp4 }
}

/**
 * Sync media items that are missing from the database
 * @param {Object[]} missingMedia - Array of missing media items
 * @param {Object} fileServer - File server object containing media data
 * @param {Object} serverConfig - Configuration for the file server
 * @param {string} serverConfig.id - Unique identifier for the server
 * @param {string} serverConfig.baseURL - Base URL of the server
 * @param {string} serverConfig.prefixPath - Prefix path for the server
 * @returns {Promise<Object>} Results of the sync operation
 */
export async function syncMissingMedia(missingMedia, fileServer, serverConfig) {
  const client = await clientPromise;
  const results = {
    processed: { movies: [], tv: [] },
    errors: { movies: [], tv: [] }
  };

  try {
    // Process movies and TV shows concurrently
    const [movieResults, tvResults] = await Promise.all([
      // Process all movies concurrently
      Promise.allSettled(
        missingMedia.movies.map(async movieTitle => {
          try {
            await processMovie(client, movieTitle, fileServer, serverConfig);
            results.processed.movies.push({
              title: movieTitle,
              serverId: serverConfig.id
            });
          } catch (error) {
            results.errors.movies.push({
              title: movieTitle,
              serverId: serverConfig.id,
              error: error.message
            });
          }
        })
      ),
      
      // Process all TV shows concurrently
      Promise.allSettled(
        missingMedia.tv.map(async show => {
          try {
            await processTVShow(client, show, fileServer, show.showTitle, serverConfig);
            results.processed.tv.push({
              title: show.showTitle,
              serverId: serverConfig.id,
              seasons: show.seasons.length
            });
          } catch (error) {
            results.errors.tv.push({
              title: show.showTitle,
              serverId: serverConfig.id,
              error: error.message
            });
          }
        })
      )
    ]);

    // Log results
    if (results.processed.movies.length > 0) {
      console.log(`Successfully processed ${results.processed.movies.length} movies from server ${serverConfig.id}`);
    }
    if (results.processed.tv.length > 0) {
      console.log(`Successfully processed ${results.processed.tv.length} TV shows from server ${serverConfig.id}`);
    }
    if (results.errors.movies.length > 0) {
      console.error(`Failed to process ${results.errors.movies.length} movies from server ${serverConfig.id}`);
    }
    if (results.errors.tv.length > 0) {
      console.error(`Failed to process ${results.errors.tv.length} TV shows from server ${serverConfig.id}`);
    }

    return results;

  } catch (error) {
    console.error(`Error in syncMissingMedia for server ${serverConfig.id}:`, error);
    throw new Error(`Failed to sync missing media from server ${serverConfig.id}: ${error.message}`);
  }
}

/**
 * Syncs metadata from a server to the database
 * @param {Object} currentDB - Current database state
 * @param {Object} fileServer - File server data
 * @param {Object} serverConfig - Server configuration
 * @returns {Promise<Object>} Sync results
 */
export async function syncMetadata(currentDB, fileServer, serverConfig) {
  console.log(chalk.bold.cyan(`Starting metadata sync for server ${serverConfig.id}...`))
  const client = await clientPromise
  const results = {
    processed: { movies: [], tv: [] },
    errors: { movies: [], tv: [] }
  }

  try {
    // Sync Movies
    await Promise.allSettled(
      currentDB.movies.map(async movie => {
        try {
          await processMovieMetadata(
            client, 
            movie, 
            fileServer?.movies[movie.title],
            serverConfig
          )
          results.processed.movies.push({
            title: movie.title,
            serverId: serverConfig.id
          })
        } catch (error) {
          results.errors.movies.push({
            title: movie.title,
            serverId: serverConfig.id,
            error: error.message
          })
        }
      })
    )

    // Sync TV Shows
    for (const show of currentDB.tv) {
      try {
        const fileServerShowData = fileServer?.tv[show.title]
        if (!fileServerShowData) {
          console.error(`TV show "${show.title}" not found in server ${serverConfig.id} data. Skipping.`)
          continue
        }

        const showMetadata = await fetchMetadataMultiServer(
          serverConfig.id,
          fileServerShowData.metadata,
          'file',
          'tv',
          show.title,
          serverConfig
        )

        if (!showMetadata) {
          console.error(`No metadata found for TV show ${show.title} on server ${serverConfig.id}. Skipping.`)
          continue
        }

        // Update show-level metadata if needed
        if (new Date(showMetadata.last_updated) > 
            new Date(show.metadata?.last_updated ?? '2024-01-01T01:00:00.000000')) {
          await updateMediaInDatabase(
            client, 
            MediaType.TV, 
            show.title, 
            { metadata: showMetadata },
            serverConfig.id
          )
        }

        // Process seasons
        await Promise.allSettled(
          show.seasons.map(season =>
            processSeasonMetadata(
              client,
              season,
              fileServerShowData,
              show,
              showMetadata,
              structuredClone(showMetadata),
              serverConfig
            )
          )
        )

        results.processed.tv.push({
          title: show.title,
          serverId: serverConfig.id,
          seasons: show.seasons.length
        })

      } catch (error) {
        results.errors.tv.push({
          title: show.title,
          serverId: serverConfig.id,
          error: error.message
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

/**
 * Syncs captions from a server to the database
 * @param {Object} currentDB - Current database state
 * @param {Object} fileServer - File server data
 * @param {Object} serverConfig - Server configuration
 * @returns {Promise<Object>} Sync results
 */
export async function syncCaptions(currentDB, fileServer, serverConfig) {
  const client = await clientPromise
  console.log(chalk.bold.white(`Starting caption sync for server ${serverConfig.id}...`))

  const results = {
    processed: { movies: [], tv: [] },
    errors: { movies: [], tv: [] }
  }

  try {
    // Process movies concurrently
    await Promise.allSettled(
      currentDB.movies.map(async movie => {
        try {
          await processMovieCaptions(
            client, 
            movie, 
            fileServer?.movies[movie.title],
            serverConfig
          )
          results.processed.movies.push({
            title: movie.title,
            serverId: serverConfig.id
          })
        } catch (error) {
          results.errors.movies.push({
            title: movie.title,
            serverId: serverConfig.id,
            error: error.message
          })
        }
      })
    )

    // Process TV shows
    for (const show of currentDB.tv) {
      const fileServerShowData = fileServer?.tv[show.title]
      if (!fileServerShowData) {
        console.error(`TV: No data/captions found for ${show.title} on server ${serverConfig.id}. Skipping.`)
        continue
      }

      try {
        // Process seasons concurrently
        await Promise.allSettled(
          show.seasons.map(async season => {
            try {
              await processSeasonCaptions(
                client, 
                show, 
                season, 
                fileServerShowData,
                serverConfig
              )
              return { success: true, seasonNumber: season.seasonNumber }
            } catch (error) {
              return { 
                success: false, 
                seasonNumber: season.seasonNumber,
                error: error.message 
              }
            }
          })
        )

        results.processed.tv.push({
          title: show.title,
          serverId: serverConfig.id,
          seasons: show.seasons.length
        })

      } catch (error) {
        results.errors.tv.push({
          title: show.title,
          serverId: serverConfig.id,
          error: error.message
        })
      }
    }

    console.log(chalk.bold.white(`Finished caption sync for server ${serverConfig.id}`))
    return results

  } catch (error) {
    console.error(`Error during caption sync for server ${serverConfig.id}:`, error)
    throw error
  }
}

/**
 * Syncs chapter information from a server to the database
 * @param {Object} currentDB - Current database state
 * @param {Object} fileServer - File server data
 * @param {Object} serverConfig - Server configuration
 * @returns {Promise<Object>} Sync results
 */
export async function syncChapters(currentDB, fileServer, serverConfig) {
  const client = await clientPromise
  console.log(chalk.bold.blue(`Starting chapter sync for server ${serverConfig.id}...`))

  const results = {
    processed: { movies: [], tv: [] },
    errors: { movies: [], tv: [] }
  }

  try {
    // Process movies concurrently
    await Promise.allSettled(
      currentDB.movies.map(async movie => {
        try {
          await processMovieChapters(
            client,
            movie,
            fileServer?.movies[movie.title],
            serverConfig
          )
          results.processed.movies.push({
            title: movie.title,
            serverId: serverConfig.id
          })
        } catch (error) {
          results.errors.movies.push({
            title: movie.title,
            serverId: serverConfig.id,
            error: error.message
          })
        }
      })
    )

    // Process TV shows
    for (const show of currentDB.tv) {
      const fileServerShowData = fileServer?.tv[show.title] || { seasons: {} }

      try {
        // Process seasons concurrently
        await Promise.allSettled(
          show.seasons.map(async season => {
            try {
              await processSeasonChapters(
                client, 
                show, 
                season, 
                fileServerShowData,
                serverConfig
              )
              return { success: true, seasonNumber: season.seasonNumber }
            } catch (error) {
              return { 
                success: false, 
                seasonNumber: season.seasonNumber,
                error: error.message 
              }
            }
          })
        )

        results.processed.tv.push({
          title: show.title,
          serverId: serverConfig.id,
          seasons: show.seasons.length
        })

      } catch (error) {
        results.errors.tv.push({
          title: show.title,
          serverId: serverConfig.id,
          error: error.message
        })
      }
    }

    console.log(chalk.bold.blue(`Finished chapter sync for server ${serverConfig.id}`))
    return results

  } catch (error) {
    console.error(`Error during chapter sync for server ${serverConfig.id}:`, error)
    throw error
  }
}

/**
 * Syncs video URLs from server to database
 */
export async function syncVideoURL(currentDB, fileServer, serverConfig) {
  const client = await clientPromise
  console.log(chalk.bold.blueBright(`Starting video URL sync for server ${serverConfig.id}...`))

  const results = {
    processed: { movies: [], tv: [] },
    errors: { movies: [], tv: [] }
  }

  try {
    // Process movies concurrently
    await Promise.allSettled(
      currentDB.movies.map(async movie => {
        try {
          await processMovieVideoURL(
            client,
            movie,
            fileServer?.movies[movie.title],
            serverConfig
          )
          results.processed.movies.push({
            title: movie.title,
            serverId: serverConfig.id
          })
        } catch (error) {
          results.errors.movies.push({
            title: movie.title,
            serverId: serverConfig.id,
            error: error.message
          })
        }
      })
    )

    // Process TV shows
    for (const show of currentDB.tv) {
      const fileServerShowData = fileServer?.tv[show.title]
      if (!fileServerShowData) {
        console.log(
          `TV show "${show.title}" not found on server ${serverConfig.id}. Skipping.`
        )
        continue
      }

      try {
        // Process seasons concurrently
        await Promise.allSettled(
          show.seasons.map(season =>
            processSeasonVideoURLs(
              client,
              show,
              season,
              fileServerShowData,
              serverConfig
            )
          )
        )

        results.processed.tv.push({
          title: show.title,
          serverId: serverConfig.id,
          seasons: show.seasons.length
        })
      } catch (error) {
        results.errors.tv.push({
          title: show.title,
          serverId: serverConfig.id,
          error: error.message
        })
      }
    }

    console.log(chalk.bold.blueBright(`Video URL sync complete for server ${serverConfig.id}`))
    return results

  } catch (error) {
    console.error(`Error during video URL sync for server ${serverConfig.id}:`, error)
    throw error
  }
}


/**
 * Syncs logos between the current database and file server for the specified server configuration.
 * @param {Object} currentDB - The current database.
 * @param {Object} fileServer - The file server data.
 * @param {Object} serverConfig - The server configuration.
 * @returns {Promise<Object>} - An object containing the results of the sync operation, including processed and errored items.
 */
export async function syncLogos(currentDB, fileServer, serverConfig) {
  const client = await clientPromise
  console.log(chalk.bold.yellow(`Starting logo sync for server ${serverConfig.id}...`))

  const results = {
    processed: { movies: [], tv: [] },
    errors: { movies: [], tv: [] }
  }

  try {
    // Process TV shows concurrently
    await Promise.allSettled(
      currentDB.tv.map(async show => {
        try {
          const updated = await processShowLogo(
            client,
            show,
            fileServer?.tv[show.title],
            serverConfig
          )
          if (updated) {
            results.processed.tv.push({
              title: show.title,
              serverId: serverConfig.id
            })
          }
        } catch (error) {
          results.errors.tv.push({
            title: show.title,
            serverId: serverConfig.id,
            error: error.message
          })
        }
      })
    )

    // Process movies concurrently
    await Promise.allSettled(
      currentDB.movies.map(async movie => {
        try {
          const updated = await processMovieLogo(
            client,
            movie,
            fileServer?.movies[movie.title],
            serverConfig
          )
          if (updated) {
            results.processed.movies.push({
              title: movie.title,
              serverId: serverConfig.id
            })
          }
        } catch (error) {
          results.errors.movies.push({
            title: movie.title,
            serverId: serverConfig.id,
            error: error.message
          })
        }
      })
    )

    console.log(chalk.bold.yellow(`Logo sync complete for server ${serverConfig.id}`))
    return results

  } catch (error) {
    console.error(`Error during logo sync for server ${serverConfig.id}:`, error)
    throw error
  }
}

/**
 * Syncs blurhash data from server to database.
 * @param {Object} currentDB - The current database.
 * @param {Object} fileServer - The file server data.
 * @param {Object} serverConfig - The configuration for the current server.
 * @returns {Promise<{ processed: { movies: Array, tv: Array }, errors: { movies: Array, tv: Array }}>} - The results of the sync operation.
 */
export async function syncBlurhash(currentDB, fileServer, serverConfig) {
  const client = await clientPromise
  console.log(chalk.bold.green(`Starting blurhash sync for server ${serverConfig.id}...`))

  const results = {
    processed: { movies: [], tv: [] },
    errors: { movies: [], tv: [] }
  }

  try {
    // Process TV shows concurrently
    await Promise.allSettled(
      currentDB.tv.map(async show => {
        try {
          const updated = await processShowBlurhash(
            client,
            show,
            fileServer?.tv[show.title],
            serverConfig
          )
          if (updated) {
            results.processed.tv.push({
              title: show.title,
              serverId: serverConfig.id
            })
          }
        } catch (error) {
          results.errors.tv.push({
            title: show.title,
            serverId: serverConfig.id,
            error: error.message
          })
        }
      })
    )

    // Process movies concurrently
    await Promise.allSettled(
      currentDB.movies.map(async movie => {
        try {
          const updated = await processMovieBlurhash(
            client,
            movie,
            fileServer?.movies[movie.title],
            serverConfig
          )
          if (updated) {
            results.processed.movies.push({
              title: movie.title,
              serverId: serverConfig.id
            })
          }
        } catch (error) {
          results.errors.movies.push({
            title: movie.title,
            serverId: serverConfig.id,
            error: error.message
          })
        }
      })
    )

    console.log(chalk.bold.green(`Blurhash sync complete for server ${serverConfig.id}`))
    return results

  } catch (error) {
    console.error(`Error during blurhash sync for server ${serverConfig.id}:`, error)
    throw error
  }
}

/**
 * Syncs video information from a server to the database
 * @param {Object} currentDB - Current database state
 * @param {Object} fileServer - File server data
 * @param {Object} serverConfig - Server configuration
 * @returns {Promise<Object>} Sync results
 */
export async function syncVideoInfo(currentDB, fileServer, serverConfig) {
  const client = await clientPromise
  console.log(chalk.bold.greenBright(`Starting video information sync for server ${serverConfig.id}...`))

  const results = {
    processed: { movies: [], tv: [] },
    errors: { movies: [], tv: [] }
  }

  try {
    // Process TV shows
    for (const show of currentDB.tv) {
      const fileServerShowData = fileServer?.tv[show.title]
      if (!fileServerShowData) {
        //console.log(`No file server data found for TV show: ${show.title} on server ${serverConfig.id}`)
        continue
      }

      try {
        // Process seasons concurrently
        const seasonResults = await Promise.allSettled(
          show.seasons.map(season =>
            processSeasonVideoInfo(
              client,
              show,
              season,
              fileServerShowData,
              serverConfig
            )
          )
        )

        const processedEpisodes = seasonResults
          .filter(result => result.status === 'fulfilled' && result.value > 0)
          .reduce((sum, result) => sum + result.value, 0)

        if (processedEpisodes > 0) {
          results.processed.tv.push({
            title: show.title,
            serverId: serverConfig.id,
            processedEpisodes
          })
        }
      } catch (error) {
        results.errors.tv.push({
          title: show.title,
          serverId: serverConfig.id,
          error: error.message
        })
      }
    }

    // Process movies concurrently
    await Promise.allSettled(
      currentDB.movies.map(async movie => {
        try {
          await processMovieVideoInfo(
            client,
            movie,
            fileServer?.movies[movie.title],
            serverConfig
          )
          results.processed.movies.push({
            title: movie.title,
            serverId: serverConfig.id
          })
        } catch (error) {
          results.errors.movies.push({
            title: movie.title,
            serverId: serverConfig.id,
            error: error.message
          })
        }
      })
    )

    console.log(chalk.bold.greenBright(`Video information sync complete for server ${serverConfig.id}.`))
    return results

  } catch (error) {
    console.error(`Error during video information sync for server ${serverConfig.id}:`, error)
    throw error
  }
}

/**
 * Syncs episode thumbnails from a server to the database
 * @param {Object} currentDB - Current database state
 * @param {Object} fileServer - File server data
 * @param {Object} serverConfig - Server configuration
 * @returns {Promise<Object>} Sync results
 */
export async function syncEpisodeThumbnails(currentDB, fileServer, serverConfig) {
  const client = await clientPromise
  console.log(chalk.bold.magentaBright(`Starting episode thumbnail sync for server ${serverConfig.id}...`))

  const results = {
    processed: { tv: [] },
    errors: { tv: [] }
  }

  try {
    // Process each TV show
    for (const show of currentDB.tv) {
      const fileServerShowData = fileServer?.tv[show.title]
      if (!fileServerShowData) {
        //console.log(`No file server data found for TV show: ${show.title} on server ${serverConfig.id}`)
        continue
      }

      try {
        let updatedEpisodes = 0

        // Process each season
        for (const season of show.seasons) {
          const seasonUpdates = await processSeasonThumbnails(
            client,
            show,
            season,
            fileServerShowData,
            serverConfig
          )

          if (seasonUpdates > 0) {
            updatedEpisodes += seasonUpdates
          }
        }

        if (updatedEpisodes > 0) {
          results.processed.tv.push({
            title: show.title,
            serverId: serverConfig.id,
            updatedEpisodes
          })
        }

      } catch (error) {
        results.errors.tv.push({
          title: show.title,
          serverId: serverConfig.id,
          error: error.message
        })
      }
    }

    console.log(chalk.bold.magentaBright(`Episode thumbnail sync complete for server ${serverConfig.id}.`))
    return results

  } catch (error) {
    console.error(`Error during episode thumbnail sync for server ${serverConfig.id}:`, error)
    throw error
  }
}

/**
 * Synchronizes poster URLs between the current database and file server.
 * @param {Object} currentDB - The current database.
 * @param {Object} fileServer - The file server data.
 * @param {Object} serverConfig - The configuration for the current server.
 * @returns {Promise<Object>} - An object containing the results of the sync operation.
 */
export async function syncPosterURLs(currentDB, fileServer, serverConfig) {
  const client = await clientPromise
  console.log(chalk.bold.magenta(`Starting poster URL sync for server ${serverConfig.id}...`))

  const results = {
    processed: { movies: [], tv: [] },
    errors: { movies: [], tv: [] }
  }

  try {
    // Process TV shows
    for (const show of currentDB.tv) {
      const fileServerShowData = fileServer?.tv[show.title]
      if (!fileServerShowData) {
        //console.log(`No file server data found for TV show: ${show.title} on server ${serverConfig.id}`)
        continue
      }

      try {
        let updatesMade = false
        const updateData = {}

        // Process show poster
        const showPosterUpdates = processShowPosterURL(show, fileServerShowData, serverConfig)
        if (showPosterUpdates) {
          Object.assign(updateData, showPosterUpdates)
          updatesMade = true
        }

        // Process season posters
        if (show.seasons && fileServerShowData.seasons) {
          const { updatedSeasons, hasUpdates } = await processSeasonPosters(
            show.seasons,
            fileServerShowData,
            serverConfig
          )
          
          if (hasUpdates) {
            updateData.seasons = updatedSeasons
            updatesMade = true
          }
        }

        if (updatesMade) {
          await updateMediaInDatabase(
            client,
            MediaType.TV,
            show.title,
            updateData,
            serverConfig.id
          )
          results.processed.tv.push({
            title: show.title,
            serverId: serverConfig.id,
            updates: Object.keys(updateData)
          })
        }

      } catch (error) {
        results.errors.tv.push({
          title: show.title,
          serverId: serverConfig.id,
          error: error.message
        })
      }
    }

    // Process movies concurrently
    await Promise.allSettled(
      currentDB.movies.map(async movie => {
        try {
          const fileServerMovieData = fileServer?.movies[movie.title]
          if (!fileServerMovieData) {
            //console.log(`No file server data found for movie: ${movie.title} on server ${serverConfig.id}`)
            return
          }

          const posterUpdates = processMoviePosterURL(movie, fileServerMovieData, serverConfig)
          if (posterUpdates) {
            await updateMediaInDatabase(
              client,
              MediaType.MOVIE,
              movie.title,
              posterUpdates,
              serverConfig.id
            )
            results.processed.movies.push({
              title: movie.title,
              serverId: serverConfig.id
            })
          }
        } catch (error) {
          results.errors.movies.push({
            title: movie.title,
            serverId: serverConfig.id,
            error: error.message
          })
        }
      })
    )

    console.log(chalk.bold.magenta(`Poster URL sync complete for server ${serverConfig.id}`))
    return results

  } catch (error) {
    console.error(`Error during poster URL sync for server ${serverConfig.id}:`, error)
    throw error
  }
}

/**
 * Synchronizes the backdrop images for movies and TV shows across multiple servers.
 *
 * This function processes the current database and file server data, updating the backdrop
 * images in the database as needed. It handles both movies and TV shows concurrently.
 *
 * @param {Object} currentDB - The current database data, containing movies and TV shows.
 * @param {Object} fileServer - The file server data, containing movie and TV show information.
 * @param {Object} serverConfig - The configuration for the current server.
 * @returns {Promise<Object>} - An object containing the results of the sync operation, including
 * the processed and errored movies and TV shows.
 */
export async function syncBackdrop(currentDB, fileServer, serverConfig) {
  const client = await clientPromise
  console.log(chalk.bold.redBright(`Starting backdrop sync for server ${serverConfig.id}...`))

  const results = {
    processed: { movies: [], tv: [] },
    errors: { movies: [], tv: [] }
  }

  try {
    // Process TV shows
    for (const show of currentDB.tv) {
      const fileServerShowData = fileServer?.tv[show.title]
      if (!fileServerShowData) {
        //console.log(`No file server data found for TV show: ${show.title} on server ${serverConfig.id}`)
        continue
      }

      try {
        const backdropUpdates = processBackdropUpdates(show, fileServerShowData, serverConfig)
        if (backdropUpdates) {
          await updateMediaInDatabase(
            client,
            MediaType.TV,
            show.title,
            backdropUpdates,
            serverConfig.id
          )
          results.processed.tv.push({
            title: show.title,
            serverId: serverConfig.id,
            updates: Object.keys(backdropUpdates)
          })
        }
      } catch (error) {
        results.errors.tv.push({
          title: show.title,
          serverId: serverConfig.id,
          error: error.message
        })
      }
    }

    // Process movies concurrently
    await Promise.allSettled(
      currentDB.movies.map(async movie => {
        try {
          const fileServerMovieData = fileServer?.movies[movie.title]
          if (!fileServerMovieData) {
            //console.log(`No file server data found for movie: ${movie.title} on server ${serverConfig.id}`)
            return
          }

          const backdropUpdates = processBackdropUpdates(movie, fileServerMovieData, serverConfig)
          if (backdropUpdates) {
            await updateMediaInDatabase(
              client,
              MediaType.MOVIE,
              movie.title,
              backdropUpdates,
              serverConfig.id
            )
            results.processed.movies.push({
              title: movie.title,
              serverId: serverConfig.id,
              updates: Object.keys(backdropUpdates)
            })
          }
        } catch (error) {
          results.errors.movies.push({
            title: movie.title,
            serverId: serverConfig.id,
            error: error.message
          })
        }
      })
    )

    console.log(chalk.bold.redBright(`Backdrop sync complete for server ${serverConfig.id}`))
    return results

  } catch (error) {
    console.error(`Error during backdrop sync for server ${serverConfig.id}:`, error)
    throw error
  }
}

export async function updateLastSynced() {
  const client = await clientPromise
  const result = await client
    .db('app_config')
    .collection('syncInfo')
    .updateOne({ _id: 'lastSyncTime' }, { $set: { timestamp: new Date() } }, { upsert: true })
  return result
}
