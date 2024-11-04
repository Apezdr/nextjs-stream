'use server'

import clientPromise from '@src/lib/mongodb'
import { addOrUpdateSeason, fetchMetadata } from '@src/utils/admin_utils'
import { filterLockedFields } from '@src/utils/sync_utils'
import chalk from 'chalk'
import { fileServerURLWithoutPrefixPath } from '@src/utils/config'
import { updateMediaUpdates } from '@src/utils/admin_frontend_database'
import { isEqual } from 'lodash'

/**
 * Sync media items that are missing from the database
 * @param {Object[]} missingMedia - Array of missing media items
 * @param {Object} fileServer - File server object
 */
export async function syncMissingMedia(missingMedia, fileServer) {
  const client = await clientPromise

  // Sync Movies
  for (const movieIndex in missingMedia.movies) {
    const movieTitle = missingMedia.movies[parseInt(movieIndex)]
    const movieData = fileServer?.movies[movieTitle]
    const movieDataFILENAMES = movieData?.fileNames
    const movieDataURLS = movieData?.urls

    // Find the MP4 file
    const mp4File = movieDataFILENAMES.find((name) => name.endsWith('.mp4'))

    if (!mp4File) {
      console.log(`Movie: No MP4 file found for ${movieTitle}. Skipping.`)
      continue
    }

    // Make a GET request to retrieve movie metadata from file server
    const movieMetadata = await fetchMetadata(movieDataURLS?.metadata, 'file', 'movie', movieTitle)

    if (!movieMetadata) {
      return console.log(`Movie: No metadata found for ${movieData}. Skipping.`)
    }
    if (typeof movieMetadata.release_date !== 'object') {
      movieMetadata.release_date = new Date(movieMetadata.release_date)
    }

    // Initialize update data
    let updateData = {
      title: movieTitle,
      videoURL: fileServerURLWithoutPrefixPath + `${movieDataURLS.mp4}`,
      mediaLastModified: new Date(movieDataURLS.mediaLastModified),
      length: movieData.length[mp4File],
      dimensions: movieData.dimensions[mp4File],
      metadata: movieMetadata,
    }

    // Add captionURLs for available subtitles
    if (movieDataURLS?.subtitles) {
      const subtitleURLs = {}
      for (const [langName, subtitleData] of Object.entries(movieDataURLS.subtitles)) {
        subtitleURLs[langName] = {
          srcLang: subtitleData.srcLang,
          url: fileServerURLWithoutPrefixPath + `${subtitleData.url}`,
          lastModified: subtitleData.lastModified,
        }
      }

      // Sort the subtitleURLs object to show English first
      const sortedSubtitleURLs = Object.entries(subtitleURLs).sort(([langNameA], [langNameB]) => {
        if (langNameA.toLowerCase().includes('english')) return -1
        if (langNameB.toLowerCase().includes('english')) return 1
        return 0
      })

      updateData.captionURLs = Object.fromEntries(sortedSubtitleURLs)
    }

    if (movieDataURLS?.poster) {
      updateData.posterURL = fileServerURLWithoutPrefixPath + `${movieDataURLS.poster}`
    }
    // Add posterBlurhash URL if it exists
    if (movieDataURLS?.posterBlurhash) {
      updateData.posterBlurhash = fileServerURLWithoutPrefixPath + `${movieDataURLS.posterBlurhash}`
    }
    // Some movies have a logo image
    if (movieDataURLS?.logo) {
      updateData.logo = fileServerURLWithoutPrefixPath + `${movieDataURLS.logo}`
    }
    // Add chapterURL if chapters file exists
    if (movieDataURLS?.chapters) {
      updateData.chapterURL = fileServerURLWithoutPrefixPath + `${movieDataURLS.chapters}`
    }
    // Add backdrop if it exists
    if (movieDataURLS?.backdrop) {
      updateData.backdrop = fileServerURLWithoutPrefixPath + `${movieDataURLS.backdrop}`
    }
    // Add backdrop blurhash if it exists
    if (movieDataURLS?.backdropBlurhash) {
      updateData.backdropBlurhash =
        fileServerURLWithoutPrefixPath + `${movieDataURLS.backdropBlurhash}`
    }

    await client
      .db('Media')
      .collection('Movies')
      .updateOne({ title: movieTitle }, { $set: updateData }, { upsert: true })

    // Update the MediaUpdatesMovie collection
    await updateMediaUpdates(movieTitle, 'movie')
  }

  // Sync TV Shows
  for (const missingShow of missingMedia.tv) {
    const showTitle = missingShow.showTitle
    const showData = fileServer?.tv[showTitle]

    // Make a GET request to retrieve show-level metadata
    const showMetadata = await fetchMetadata(showData.metadata, 'file', 'tv', showTitle)

    if (!showMetadata) {
      return console.log(`TV: No metadata found for ${showTitle}. Skipping.`)
    }

    const currentShow = (await client
      .db('Media')
      .collection('TV')
      .findOne({ title: showTitle })) || { seasons: [] }

    // Use Promise.all to wait for all seasons to be updated
    await Promise.all(
      missingShow.seasons.map((seasonInfo) =>
        addOrUpdateSeason(currentShow, seasonInfo, showTitle, fileServer, showMetadata)
      )
    )

    currentShow.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber)

    /* const posterBlurhashResponse = await fetchMetadata(showData.posterBlurhash)
      const backdropBlurhashResponse = await fetchMetadata(showData.backdropBlurhash) */

    // Add posterBlurhash & backdropBlurhash URL if it exists
    const posterBlurhash = showData.posterBlurhash
    const backdropBlurhash = showData.backdropBlurhash

    const showUpdateData = {
      // ...other show data,
      metadata: showMetadata,
      seasons: currentShow.seasons,
      posterURL: fileServerURLWithoutPrefixPath + `${showData.poster}`,
      posterBlurhash: fileServerURLWithoutPrefixPath + `${posterBlurhash}`,
      backdrop: fileServerURLWithoutPrefixPath + `${showData.backdrop}`,
      backdropBlurhash: fileServerURLWithoutPrefixPath + `${backdropBlurhash}`,
    }

    if (showData.logo) {
      showUpdateData.logo = fileServerURLWithoutPrefixPath + `${showData.logo}`
    }

    await client
      .db('Media')
      .collection('TV')
      .updateOne({ title: showTitle }, { $set: showUpdateData }, { upsert: true })
    // Update the MediaUpdatesTV collection
    await updateMediaUpdates(showTitle, 'tv')
  }
}

/**
 *
 * @param {Object} fileServer - The data structure representing media available on the file server.
 * @param {Object} currentDB - The current state of the media database.
 *
 */
export async function syncMetadata(currentDB, fileServer) {
  console.log(chalk.bold.cyan('Starting Syncing metadata...'))
  const client = await clientPromise
  // Sync Movies
  for (const movie of currentDB.movies) {
    try {
      // Access the current movie data from currentDB
      const currentDB_movieData = movie

      // Ensure the movie exists in the file server data
      const fileServer_movieData = fileServer?.movies[movie.title]
      if (!fileServer_movieData) {
        console.error(`Movie "${movie.title}" not found in file server data. Skipping.`)
        continue
      }
      const fileServer_movieDataURLS = fileServer_movieData?.urls ?? {
        metadata: null,
      }

      // Fetch movie metadata from file server
      let movieMetadata
      try {
        movieMetadata = await fetchMetadata(
          fileServer_movieDataURLS?.metadata,
          'file',
          'movie',
          movie.title
        )
      } catch (error) {
        console.error(`Failed to fetch metadata for movie "${movie.title}":`, error)
        continue // Skip this movie and proceed to the next
      }

      // Ensure release_date is a Date object
      if (typeof movieMetadata.release_date !== 'object') {
        movieMetadata.release_date = new Date(movieMetadata.release_date)
      }

      // Compare last_updated timestamps
      const existingMetadataLastUpdated = new Date(
        currentDB_movieData.metadata?.last_updated ?? '1970-01-01T00:00:00.000Z'
      )
      const newMetadataLastUpdated = new Date(movieMetadata.last_updated)

      if (newMetadataLastUpdated > existingMetadataLastUpdated) {
        // Prepare the update data
        const updateData = { metadata: movieMetadata }

        // Filter out locked fields
        const filteredUpdateData = filterLockedFields(currentDB_movieData, updateData)

        // If 'metadata' is empty after filtering, remove it from updateData
        if (filteredUpdateData.metadata && Object.keys(filteredUpdateData.metadata).length === 0) {
          delete filteredUpdateData.metadata
        }

        // Proceed with the update if there are fields to update
        if (Object.keys(filteredUpdateData).length > 0) {
          console.log(`Movie: Updating metadata for "${movie.title}"`)

          await client
            .db('Media')
            .collection('Movies')
            .updateOne({ title: movie.title }, { $set: filteredUpdateData }, { upsert: true })

          // Update the MediaUpdatesMovie collection
          await updateMediaUpdates(movie.title, 'movie')
        } else {
          console.log(`All metadata fields are locked for movie "${movie.title}". Skipping update.`)
        }
      }
    } catch (error) {
      console.error(`Error in movie metadata processing ${movie.title}:`, error)
      throw error // Rethrow the error to be handled by the calling function
    }
  }
  // Sync TV
  let tv_metadata = {
    name: '',
  }
  for (const tv of currentDB.tv) {
    try {
      // Set the file server show data
      const fileServer_showData = fileServer?.tv[tv.title]
      // Set the current DB show data
      const currentDB_showData = tv
      const currentDB_showDataSEASONS = currentDB_showData?.seasons
      const currentDB_showDataMETADATA = currentDB_showData?.metadata
      // Make a GET request to retrieve show-level metadata
      let mostRecent_showMetadata
      try {
        mostRecent_showMetadata = await fetchMetadata(
          fileServer_showData.metadata,
          'file',
          'tv',
          tv.title
        )
      } catch (error) {
        console.error(`Failed to fetch metadata for TV show ${tv.title}:`, error)
      }

      if (mostRecent_showMetadata.name !== tv_metadata.name) {
        tv_metadata = structuredClone(mostRecent_showMetadata)
      }
      // Store the Current DB Season - Episode Data
      var currentDB_memory_season = {}

      // First check the last updated date of the show metadata
      if (
        new Date(mostRecent_showMetadata.last_updated) >
        new Date(currentDB_showDataMETADATA?.last_updated ?? '2024-01-01T01:00:00.000000')
      ) {
        // Update show metadata
        console.log('TV: Updating show metadata', tv.title)
        await client
          .db('Media')
          .collection('TV')
          .updateOne(
            { title: tv.title },
            { $set: { metadata: mostRecent_showMetadata } },
            { upsert: true }
          )

        // Update the MediaUpdatesTV collection
        await updateMediaUpdates(tv.title, 'tv')
      }

      // Then check the last updated date of the season metadata
      for await (const season of currentDB_showDataSEASONS) {
        try {
          if (
            Object.keys(currentDB_memory_season).length === 0 ||
            currentDB_memory_season.seasonNumber !== season.seasonNumber
          ) {
            currentDB_memory_season = structuredClone(season)
          }

          // Ensure currentDB_memory_season.metadata.episodes is defined and is an array
          if (!Array.isArray(currentDB_memory_season.metadata.episodes)) {
            console.error(
              `${tv.title} - currentDB_memory_season.metadata.episodes is not an array or is undefined`
            )
            // Handle the error appropriately, e.g., throw an error or return a default value
            throw new Error(
              `Invalid data structure: ${tv.title} currentDB_memory_season.metadata.episodes is not an array or is undefined`
            )
          }

          const fileServer_seasonData =
            fileServer_showData.seasons[`Season ${currentDB_memory_season.seasonNumber}`]
          if (!fileServer_seasonData) {
            console.error(
              `${tv.title} - Season ${currentDB_memory_season.seasonNumber} - fileServer_seasonData is undefined`
            )
            // Handle the error appropriately, e.g., throw an error or return a default value
            throw new Error(
              `Invalid data structure: ${tv.title} Season ${currentDB_memory_season.seasonNumber} fileServer_seasonData is undefined`
            )
          }

          const fileServer_seasonDataFILENAMES = fileServer_seasonData?.fileNames
          const fileServer_seasonDataURLS = fileServer_seasonData?.urls

          let seasonNeedsUpdate = false

          // Create a Set to store the episode numbers of existing episodes in currentDB
          const existingEpisodeNumbers = new Set(
            currentDB_memory_season.metadata.episodes.map((episode) => episode.episode_number)
          )

          for await (const episodeFileName of fileServer_seasonDataFILENAMES) {
            try {
              const episodeData = fileServer_seasonDataURLS[episodeFileName] ?? {
                metadata: null,
              }
              const episodeDataMETADATA = episodeData?.metadata
              let mostRecent_episodeMetadata
              try {
                mostRecent_episodeMetadata = await fetchMetadata(
                  episodeDataMETADATA,
                  'file',
                  'tv',
                  tv.title
                )
              } catch (error) {
                console.error(`Failed to fetch metadata for ${tv.title}:`, error)
                // Handle the error appropriately, e.g., throw an error or return a default value
                throw new Error(`Failed to fetch metadata for ${tv.title}`)
              }

              if (!mostRecent_episodeMetadata) {
                console.error('TV: Metadata fetch failed for', episodeFileName, episodeDataMETADATA)
                continue
              }

              // Check if the episode exists in currentDB
              const episodeExists = existingEpisodeNumbers.has(
                mostRecent_episodeMetadata.episode_number
              )

              if (episodeExists) {
                // Find the corresponding episode in currentDB
                const currentDB_episode = currentDB_memory_season.metadata.episodes.find(
                  (e) => e.episode_number === mostRecent_episodeMetadata.episode_number
                )
                const currentDB_episodeMetadata = currentDB_memory_season?.metadata?.episodes.find(
                  (e) =>
                    e.episode_number === currentDB_episode?.episode_number &&
                    e.season_number === currentDB_episode?.season_number
                )

                // Check if the File Server episode metadata is newer than the currentDB metadata
                // for this episode
                if (
                  currentDB_episode &&
                  new Date(mostRecent_episodeMetadata.last_updated) >
                    new Date(
                      currentDB_episodeMetadata?.last_updated ?? '2024-01-01T01:00:00.000000'
                    )
                ) {
                  // Logic to update this episode's metadata in currentDB
                  // console.log(
                  //   `TV: Updating episode metadata for ${episodeFileName} in ${tv.title}, Season ${currentDB_memory_season.seasonNumber}`
                  // )

                  tv_metadata = {
                    ...tv_metadata,
                    seasons: tv_metadata.seasons.map((season) => {
                      if (season.season_number === currentDB_memory_season.seasonNumber) {
                        currentDB_memory_season.metadata.episodes =
                          currentDB_memory_season.metadata.episodes.map((episode) => {
                            if (
                              episode.episode_number === mostRecent_episodeMetadata.episode_number
                            ) {
                              seasonNeedsUpdate = true
                              console.log(
                                'TV: --Updating episode metadata',
                                tv.title,
                                `Season ${currentDB_memory_season.seasonNumber} E${episode.episode_number}`
                                //mostRecent_episodeMetadata
                              )
                              return mostRecent_episodeMetadata
                            } else {
                              return episode
                            }
                          })
                        return {
                          ...season,
                          episodes: currentDB_memory_season.metadata.episodes,
                        }
                      }
                      return season
                    }),
                  }
                }
              } else {
                // Episode doesn't exist in currentDB, add it to tv_metadata
                console.log(
                  `TV: Adding missing episode metadata for ${episodeFileName} in ${tv.title}, Season ${currentDB_memory_season.seasonNumber}`
                )

                tv_metadata = {
                  ...tv_metadata,
                  seasons: tv_metadata.seasons.map((_season) => {
                    if (_season.season_number === currentDB_memory_season.seasonNumber) {
                      let episodes = _season.episodes || []

                      // Check if the episodes array is empty
                      if (episodes.length === 0) {
                        // Populate the initial list of available episodes from currentDB_memory_season.metadata.episodes
                        episodes = currentDB_memory_season.metadata.episodes
                      }

                      // Check if the episode exists in the episodes array
                      const episodeExists = episodes.some(
                        (episode) =>
                          episode.episode_number === mostRecent_episodeMetadata.episode_number
                      )

                      if (!episodeExists) {
                        console.log(
                          `TV: Adding missing episode metadata for ${episodeFileName} in ${tv.title}, Season ${currentDB_memory_season.seasonNumber}`
                        )

                        // Add the missing episode metadata to the current season
                        const updatedEpisodes = [...episodes, mostRecent_episodeMetadata]

                        // Sort the updated episodes array based on the episode number
                        const sortedEpisodes = updatedEpisodes.sort(
                          (a, b) => a.episode_number - b.episode_number
                        )

                        return {
                          ..._season,
                          episodes: sortedEpisodes,
                        }
                      }

                      return _season
                    }
                    return _season
                  }),
                }

                seasonNeedsUpdate = true
              }
            } catch (error) {
              console.error(
                `Error in tv metadata processing "${tv.title}" Season: ${season.seasonNumber}, ${episodeFileName}`,
                error
              )
              throw error // Rethrow the error to be handled by the calling function
            }
          }

          if (seasonNeedsUpdate) {
            console.log('tv_metadata', tv_metadata)
          }

          if (
            new Date(mostRecent_showMetadata.seasons?.last_updated) >
            new Date(
              currentDB_memory_season.metadata.episodes?.last_updated ??
                '2024-01-01T01:00:00.000000'
            )
          ) {
            console.log(
              'TV: Old Show Data',
              tv.title,
              `Season ${currentDB_memory_season.seasonNumber}`
            )
            seasonNeedsUpdate = true
          }

          // After processing all episodes, check if the season needs an update
          if (seasonNeedsUpdate) {
            console.log(
              'TV: Updating season metadata',
              tv.title,
              `Season ${currentDB_memory_season.seasonNumber}`
            )
            // Perform the necessary update for the season metadata here
            await client
              .db('Media')
              .collection('TV')
              .updateOne(
                { title: tv.title },
                {
                  $set: {
                    'seasons.$[elem].metadata': tv_metadata.seasons.find(
                      (s) => s.season_number === currentDB_memory_season.seasonNumber
                    ),
                  },
                },
                { arrayFilters: [{ 'elem.seasonNumber': currentDB_memory_season.seasonNumber }] },
                { upsert: true }
              )
          }
        } catch (error) {
          console.error(
            `Error in tv metadata processing "${tv.title}" Season: ${season.seasonNumber}:`,
            error
          )
          throw error // Rethrow the error to be handled by the calling function
        }
      }
    } catch (error) {
      console.error(`Error in tv metadata processing ${tv.title}:`, error)
      throw error // Rethrow the error to be handled by the calling function
    }
  }
  console.log(chalk.bold.cyan('Finished Syncing metadata...'))
}

/**
 *
 * @param {Object} fileServer - The data structure representing media available on the file server.
 * @param {Object} currentDB - The current state of the media database.
 *
 */
export async function syncCaptions(currentDB, fileServer) {
  const client = await clientPromise
  console.log(chalk.bold.white('Starting Syncing captions...'))

  // Iterate through movies
  for (const movie of currentDB.movies) {
    // Retrieve the file server movie data
    const fileServerMovieData = fileServer?.movies[movie.title]
    const fileServerMovieDataURLS = fileServerMovieData?.urls

    if (!fileServerMovieDataURLS) {
      console.error(`Movie: No data found for ${movie.title}. Skipping.`)
      continue
    }

    // If there are subtitles data
    if (fileServerMovieDataURLS?.subtitles) {
      const updatedCaptionsURLs = { ...movie.captionURLs } // Create a copy of existing captions

      // Iterate through subtitles and update captionURLs
      for (const [langName, subtitleData] of Object.entries(fileServerMovieDataURLS.subtitles)) {
        // Check if the subtitle data has a lastModified property
        if (subtitleData.lastModified) {
          // Compare the lastModified date with the existing date in the movie's captionURLs
          const existingSubtitle = movie.captionURLs?.[langName]
          if (
            !existingSubtitle ||
            new Date(subtitleData.lastModified) > new Date(existingSubtitle.lastModified)
          ) {
            updatedCaptionsURLs[langName] = {
              url: fileServerURLWithoutPrefixPath + subtitleData.url,
              srcLang: subtitleData.srcLang,
              lastModified: subtitleData.lastModified,
            }
          }
        } else {
          // If lastModified is not available, add the subtitle data
          updatedCaptionsURLs[langName] = {
            url: fileServerURLWithoutPrefixPath + subtitleData.url,
            srcLang: subtitleData.srcLang,
          }
        }
      }

      // Sort the updatedCaptionsURLs object to show English first
      const sortedCaptionsURLs = Object.entries(updatedCaptionsURLs).sort(
        ([langNameA], [langNameB]) => {
          if (langNameA.toLowerCase().includes('english')) return -1
          if (langNameB.toLowerCase().includes('english')) return 1
          return 0
        }
      )

      // Update the movie in MongoDB if there are updated captions
      if (sortedCaptionsURLs.length > 0) {
        const hasChanges = !isEqual(movie.captionURLs, Object.fromEntries(sortedCaptionsURLs))
        if (hasChanges) {
          console.log(`Movie: Updating captions for ${movie.title}`)
          await client
            .db('Media')
            .collection('Movies')
            .updateOne(
              {
                title: movie.title,
              },
              {
                $set: {
                  captionURLs: Object.fromEntries(sortedCaptionsURLs),
                },
              }
            )

          // Update the MediaUpdatesMovie collection
          await updateMediaUpdates(movie.title, 'movie')
        }
      }
    }
  }

  // Iterate through TV shows
  for (const tv of currentDB.tv) {
    // Retrieve the file server show data
    const fileServerShowData = fileServer?.tv[tv.title]

    // Iterate through seasons
    for (const season of tv.seasons) {
      // Retrieve the file server season data
      const fileServerSeasonData = fileServerShowData.seasons[`Season ${season.seasonNumber}`]
      const fileServerSeasonDataURLS = fileServerSeasonData?.urls

      if (!fileServerSeasonDataURLS) {
        console.error(
          `TV: No data found for ${tv.title} - Season ${season.seasonNumber}. Skipping.`
        )
        continue
      }

      // Iterate through episodes
      for (const episode of season.episodes) {
        // Construct the episode file name based on a pattern or directly from the fileServer data
        const episodeFileName = Object.keys(fileServerSeasonDataURLS).find((fileName) => {
          const fileNameWithoutExtension = fileName.slice(0, -4) // Remove the file extension
          const episodeNumberRegex = new RegExp(
            `S\\d{2}E${episode.episodeNumber.toString().padStart(2, '0')}`,
            'i'
          )
          return episodeNumberRegex.test(fileNameWithoutExtension)
        })

        // If episode file found in file server data
        if (episodeFileName) {
          const fileServerEpisodeData = fileServerSeasonDataURLS[episodeFileName]

          // If there are subtitles data
          if (fileServerEpisodeData.subtitles) {
            const updatedCaptionsURLs = { ...episode.captionURLs } // Create a copy of existing captions

            // Iterate through subtitles and update captionURLs
            for (const [langName, subtitleData] of Object.entries(
              fileServerEpisodeData.subtitles
            )) {
              // Check if the subtitle data has a lastModified property
              if (subtitleData.lastModified) {
                // Compare the lastModified date with the existing date in the episode's captionURLs
                const existingSubtitle = episode.captionURLs?.[langName]
                if (
                  !existingSubtitle ||
                  new Date(subtitleData.lastModified) > new Date(existingSubtitle.lastModified)
                ) {
                  updatedCaptionsURLs[langName] = {
                    url: fileServerURLWithoutPrefixPath + subtitleData.url,
                    srcLang: subtitleData.srcLang,
                    lastModified: subtitleData.lastModified,
                  }
                }
              } else {
                // If lastModified is not available, add the subtitle data
                updatedCaptionsURLs[langName] = {
                  url: fileServerURLWithoutPrefixPath + subtitleData.url,
                  srcLang: subtitleData.srcLang,
                }
              }
            }

            // Sort the updatedCaptionsURLs object to show English first
            const sortedCaptionsURLs = Object.entries(updatedCaptionsURLs).sort(
              ([langNameA], [langNameB]) => {
                if (langNameA.toLowerCase().includes('english')) return -1
                if (langNameB.toLowerCase().includes('english')) return 1
                return 0
              }
            )

            // Check if there are any changes in the captions URLs
            const hasChanges = !isEqual(episode.captionURLs, Object.fromEntries(sortedCaptionsURLs))

            // Update the episode in MongoDB if there are updated captions
            if (hasChanges) {
              // For Logging
              const addedSubtitles = Object.entries(Object.fromEntries(sortedCaptionsURLs))
                .filter(([langName]) => !episode.captionURLs?.[langName])
                .map(([langName, subtitleData]) => `${langName} (${subtitleData.srcLang})`)
                .join(', ')

              console.log(
                `TV: Updating captions for ${tv.title} - Season ${season.seasonNumber}, Episode ${episode.episodeNumber}`,
                addedSubtitles ? `Added subtitles: ${addedSubtitles}` : ''
              )
              await client
                .db('Media')
                .collection('TV')
                .updateOne(
                  {
                    title: tv.title,
                    'seasons.seasonNumber': season.seasonNumber,
                    'seasons.episodes.episodeNumber': episode.episodeNumber,
                  },
                  {
                    $set: {
                      'seasons.$.episodes.$[episode].captionURLs':
                        Object.fromEntries(sortedCaptionsURLs),
                    },
                  },
                  {
                    arrayFilters: [{ 'episode.episodeNumber': episode.episodeNumber }],
                  }
                )

              // Update the MediaUpdatesTV collection
              await updateMediaUpdates(tv.title, 'tv')
            }
          }
        }
      }
    }
  }

  console.log(chalk.bold.white('Finished Syncing captions...'))
}

/**
 * Sync subtitles/chapters from a file server to the current database.
 *
 * @param {Object} currentDB - The database to sync chapters to
 * @param {Object} fileServer - The file server to fetch chapter data from
 */
export async function syncChapters(currentDB, fileServer) {
  const client = await clientPromise
  console.log(chalk.bold.blue('Starting chapter synchronization...'))

  // Iterate through movies
  for (const movie of currentDB.movies) {
    // Retrieve the file server movie data or default to empty if not present
    const fileServerMovieData = fileServer?.movies[movie.title] || { urls: {} }
    const fileServerMovieDataURLS = fileServerMovieData?.urls

    // If there is a chapters URL
    if (fileServerMovieDataURLS.chapters) {
      const chaptersURL = fileServerURLWithoutPrefixPath + fileServerMovieDataURLS.chapters

      // Update if chapter URL is different
      if (movie.chapterURL !== chaptersURL) {
        console.log(`Movie: Updating chapters for ${movie.title}`)
        await client
          .db('Media')
          .collection('Movies')
          .updateOne(
            {
              title: movie.title,
            },
            {
              $set: {
                chapterURL: chaptersURL,
              },
            }
          )
      }
    } else {
      // Remove the chapter URL if none found
      if (movie.chapterURL) {
        console.log(`Movie: Removing chapters for ${movie.title}`)
        await client
          .db('Media')
          .collection('Movies')
          .updateOne(
            {
              title: movie.title,
            },
            {
              $unset: {
                chapterURL: '',
              },
            }
          )
      }
    }
  }

  // Iterate through TV shows
  for (const tv of currentDB.tv) {
    // Retrieve the file server show data or default to empty if not present
    const fileServerShowData = fileServer?.tv[tv.title] || { seasons: {} }

    // Iterate through seasons
    for (const season of tv.seasons) {
      // Retrieve the file server season data or default to empty object if not present
      const fileServerSeasonData = fileServerShowData.seasons[`Season ${season.seasonNumber}`] || {
        urls: {},
      }
      const fileServerSeasonDataURLS = fileServerSeasonData?.urls

      // Iterate through episodes
      for (const episode of season.episodes) {
        // Determine the existence of episode file based on expected naming convention
        const episodeFileName = Object.keys(fileServerSeasonDataURLS).find((fileName) => {
          const fileNameWithoutExtension = fileName.slice(0, -4) // Remove the file extension
          const episodeNumberRegex = new RegExp(
            `S\\d{2}E${episode.episodeNumber.toString().padStart(2, '0')}`,
            'i'
          )
          return episodeNumberRegex.test(fileNameWithoutExtension)
        })

        const fileServerEpisodeData = episodeFileName
          ? fileServerSeasonDataURLS[episodeFileName]
          : null

        // Handle updating or removing chapter URLs based on file server data
        if (fileServerEpisodeData && fileServerEpisodeData.chapters) {
          const chaptersURL = fileServerURLWithoutPrefixPath + fileServerEpisodeData.chapters

          // Update chapter URL if different
          if (
            episode.chapterURL !== chaptersURL ||
            episode.chapterURL === undefined ||
            episode.chapterURL === null
          ) {
            console.log(
              `TV: Updating chapters for ${tv.title} - Season ${season.seasonNumber}, Episode ${episode.episodeNumber}`
            )
            await client
              .db('Media')
              .collection('TV')
              .updateOne(
                {
                  title: tv.title,
                  'seasons.seasonNumber': season.seasonNumber,
                  'seasons.episodes.episodeNumber': episode.episodeNumber,
                },
                {
                  $set: { 'seasons.$.episodes.$[episode].chapterURL': chaptersURL },
                },
                {
                  arrayFilters: [{ 'episode.episodeNumber': episode.episodeNumber }],
                }
              )
          }
        } else {
          // Remove chapter URL if no chapters found or if the episode file itself is not found
          if (episode.chapterURL && episode.chapterURL !== undefined) {
            console.log(
              `TV: Removing chapters for ${tv.title} - Season ${season.seasonNumber}, Episode ${episode.episodeNumber}`
            )
            await client
              .db('Media')
              .collection('TV')
              .updateOne(
                {
                  title: tv.title,
                  'seasons.seasonNumber': season.seasonNumber,
                  'seasons.episodes.episodeNumber': episode.episodeNumber,
                },
                {
                  $unset: { 'seasons.$.episodes.$[episode].chapterURL': '' },
                },
                {
                  arrayFilters: [{ 'episode.episodeNumber': episode.episodeNumber }],
                }
              )
          }
        }
      }
    }
  }
  console.log(chalk.bold.blue('Chapter synchronization complete.'))
}

/**
 * Syncs video URLs between the current database and file server
 * @param {Object} currentDB - The current database
 * @param {Object} fileServer - The file server data
 * @returns {Promise} - Resolves when sync is complete
 */
export async function syncVideoURL(currentDB, fileServer) {
  const client = await clientPromise
  console.log(chalk.bold.blueBright('Starting video URL synchronization...'))

  // Iterate through movies
  for (const movie of currentDB.movies) {
    // Retrieve the file server movie data
    const fileServerMovieData = fileServer?.movies[movie.title]
    const fileServerMovieDataURLS = fileServerMovieData?.urls

    if (!fileServerMovieData) {
      console.log(`Movie "${movie.title}" not found on file server. Skipping.`)
      continue
    }

    // Check if the file server video URL exists
    if (fileServerMovieDataURLS?.mp4) {
      const newVideoURL = fileServerURLWithoutPrefixPath + fileServerMovieDataURLS.mp4
      const currentVideoURL = movie.videoURL

      // Compare the current video URL with the file server's video URL
      if (newVideoURL !== currentVideoURL) {
        // Prepare the update data
        const updateData = { videoURL: newVideoURL }

        // Use filterLockedFields to exclude locked fields from updateData
        const filteredUpdateData = filterLockedFields(movie, updateData)

        // Check if 'videoURL' was filtered out due to being locked
        if (filteredUpdateData.videoURL) {
          console.log(`Movie: Updating video URL for "${movie.title}"`)
          await client
            .db('Media')
            .collection('Movies')
            .updateOne({ title: movie.title }, { $set: { videoURL: filteredUpdateData.videoURL } })

          // Update the MediaUpdatesMovie collection
          await updateMediaUpdates(movie.title, 'movie')
        } else {
          console.log(
            `Field "videoURL" is locked for movie "${movie.title}". Skipping video URL update.`
          )
        }
      }
      /*  else {
          console.log(`Movie "${movie.title}" video URL is already up-to-date. Skipping.`)
        } */
    } else {
      console.log(`No MP4 video URL found for movie "${movie.title}" on file server. Skipping.`)
    }
  }

  // Iterate through TV shows (unchanged, as locking isn't implemented yet)
  for (const tv of currentDB.tv) {
    // Retrieve the file server show data
    const fileServerShowData = fileServer?.tv[tv.title]

    if (!fileServerShowData) {
      console.log(`TV show "${tv.title}" not found on file server. Skipping.`)
      continue
    }

    // Iterate through seasons
    for (const season of tv.seasons) {
      // Retrieve the file server season data
      const fileServerSeasonData = fileServerShowData.seasons[`Season ${season.seasonNumber}`]
      const fileServerSeasonDataURLS = fileServerSeasonData?.urls

      if (!fileServerSeasonData) {
        console.log(
          `Season ${season.seasonNumber} for TV show "${tv.title}" not found on file server. Skipping.`
        )
        continue
      }

      // Iterate through episodes
      for (const episode of season.episodes) {
        // Construct the episode file name based on a pattern or directly from the fileServer data
        const episodeFileName = Object.keys(fileServerSeasonDataURLS).find((fileName) => {
          const fileNameWithoutExtension = fileName.slice(0, -4) // Remove the file extension
          const episodeNumberRegex = new RegExp(
            `(S?${season.seasonNumber.toString().padStart(2, '0')}E${episode.episodeNumber.toString().padStart(2, '0')})|^${episode.episodeNumber.toString().padStart(2, '0')}\\s?-`,
            'i'
          )
          const evaluatedFilename = episodeNumberRegex.test(fileNameWithoutExtension)
          return evaluatedFilename
        })

        // If episode file found in file server data
        if (episodeFileName) {
          const fileServerEpisodeData = fileServerSeasonDataURLS[episodeFileName]

          // If the file server video URL is different from the current video URL
          const currentVideoURL = episode.videoURL.replace(fileServerURLWithoutPrefixPath, '')
          if (fileServerEpisodeData.videourl !== currentVideoURL) {
            console.log(
              `TV: Updating video URL for "${tv.title}" - Season ${season.seasonNumber}, Episode ${episode.episodeNumber}`
            )
            await client
              .db('Media')
              .collection('TV')
              .updateOne(
                {
                  title: tv.title,
                  'seasons.seasonNumber': season.seasonNumber,
                  'seasons.episodes.episodeNumber': episode.episodeNumber,
                },
                {
                  $set: {
                    'seasons.$.episodes.$[episode].videoURL':
                      fileServerURLWithoutPrefixPath + fileServerEpisodeData.videourl,
                  },
                },
                {
                  arrayFilters: [{ 'episode.episodeNumber': episode.episodeNumber }],
                }
              )
          }
        } else {
          console.log(
            `Episode file not found for "${tv.title}" - Season ${season.seasonNumber}, Episode ${episode.episodeNumber}. Skipping video URL update.`
          )
        }
      }
    }
  }
  console.log(chalk.bold.blueBright('Video URL synchronization complete.'))
}

/**
 * Syncs logo urls between the current database and file server
 * @param {Object} currentDB - The current database
 * @param {Object} fileServer - The file server data
 * @returns {Promise} - Resolves when sync is complete
 */
export async function syncLogos(currentDB, fileServer) {
  const client = await clientPromise
  console.log(chalk.bold.yellow('Starting logo synchronization...'))

  // Iterate through TV shows
  for (const tv of currentDB.tv) {
    // Retrieve the file server show data
    const fileServerShowData = fileServer?.tv[tv.title]

    if (fileServerShowData?.logo) {
      if (
        !tv.logo ||
        fileServerShowData.logo !== tv.logo.replace(fileServerURLWithoutPrefixPath, '')
      ) {
        console.log(`TV: Updating logo URL for ${tv.title}`)
        await client
          .db('Media')
          .collection('TV')
          .updateOne(
            {
              title: tv.title,
            },
            {
              $set: {
                logo: fileServerURLWithoutPrefixPath + fileServerShowData.logo,
              },
            }
          )
      }
    }
  }

  // Iterate through movies
  for (const movie of currentDB.movies) {
    // Retrieve the file server movie data
    const fileServerMovieData = fileServer?.movies[movie.title]
    const fileServerMovieDataURLS = fileServerMovieData?.urls

    // If the file server video poster is different from the current posterURL
    if (fileServerMovieDataURLS?.logo) {
      if (
        !movie.logo ||
        fileServerMovieDataURLS.logo !== movie.logo.replace(fileServerURLWithoutPrefixPath, '')
      ) {
        console.log(`Movie: Updating posterURL for ${movie.title}`)
        await client
          .db('Media')
          .collection('Movies')
          .updateOne(
            {
              title: movie.title,
            },
            {
              $set: {
                logo: fileServerURLWithoutPrefixPath + fileServerMovieDataURLS.logo,
              },
            }
          )
      }
    }
  }
  console.log(chalk.bold.yellow('Logo synchronization complete.'))
}

/**
 * Syncs blurhash image urls between the current database and file server
 * @param {Object} currentDB - The current database
 * @param {Object} fileServer - The file server data
 * @returns {Promise} - Resolves when sync is complete
 */
export async function syncBlurhash(currentDB, fileServer) {
  const client = await clientPromise
  console.log(chalk.bold.green('Starting blurhash synchronization...'))

  // Iterate through TV shows
  for (const tv of currentDB.tv) {
    const fileServerShowData = fileServer?.tv[tv.title]

    if (fileServerShowData) {
      const updateData = {}
      const unsetData = {}

      // Update posterBlurhash URL if it exists, or remove it if it doesn't exist in fileServerShowData
      if (
        fileServerShowData.posterBlurhash &&
        (!tv.posterBlurhash ||
          fileServerShowData.posterBlurhash !==
            tv.posterBlurhash.replace(fileServerURLWithoutPrefixPath, ''))
      ) {
        updateData.posterBlurhash =
          fileServerURLWithoutPrefixPath + fileServerShowData.posterBlurhash
        console.log(`TV: Updating posterBlurhash for ${tv.title}`)
      } else if (!fileServerShowData.posterBlurhash && tv.posterBlurhash) {
        unsetData.posterBlurhash = ''
        console.log(`TV: Removing posterBlurhash for ${tv.title}`)
      }

      // Update backdropBlurhash URL if it exists, or remove it if it doesn't exist in fileServerShowData
      if (
        fileServerShowData.backdropBlurhash &&
        (!tv.backdropBlurhash ||
          fileServerShowData.backdropBlurhash !==
            tv.backdropBlurhash.replace(fileServerURLWithoutPrefixPath, ''))
      ) {
        updateData.backdropBlurhash =
          fileServerURLWithoutPrefixPath + fileServerShowData.backdropBlurhash
        console.log(`TV: Updating backdropBlurhash for ${tv.title}`)
      } else if (!fileServerShowData.backdropBlurhash && tv.backdropBlurhash) {
        unsetData.backdropBlurhash = ''
        console.log(`TV: Removing backdropBlurhash for ${tv.title}`)
      }

      // Update season poster blurhash
      if (tv.seasons && fileServerShowData.seasons) {
        const updatedSeasons = tv.seasons.map((season) => {
          const fileServerSeasonData = fileServerShowData.seasons[`Season ${season.seasonNumber}`]
          if (fileServerSeasonData && fileServerSeasonData.seasonPosterBlurhash) {
            if (
              !season.seasonPosterBlurhash ||
              fileServerSeasonData.seasonPosterBlurhash !==
                season.seasonPosterBlurhash.replace(fileServerURLWithoutPrefixPath, '')
            ) {
              console.log(
                `TV Season: Updating seasonPosterBlurhash for ${tv.title} Season ${season.seasonNumber}`
              )
              return {
                ...season,
                seasonPosterBlurhash:
                  fileServerURLWithoutPrefixPath + fileServerSeasonData.seasonPosterBlurhash,
              }
            }
          } else if (season.seasonPosterBlurhash) {
            console.log(
              `TV Season: Removing seasonPosterBlurhash for ${tv.title} Season ${season.seasonNumber}`
            )
            const { seasonPosterBlurhash, ...seasonWithoutBlurhash } = season
            return seasonWithoutBlurhash
          }
          return season
        })

        if (JSON.stringify(updatedSeasons) !== JSON.stringify(tv.seasons)) {
          updateData.seasons = updatedSeasons
        }
      }

      if (Object.keys(updateData).length > 0 || Object.keys(unsetData).length > 0) {
        await client
          .db('Media')
          .collection('TV')
          .updateOne({ title: tv.title }, { $set: updateData, $unset: unsetData })

        // Update the MediaUpdatesTV collection
        await updateMediaUpdates(tv.title, 'tv')
        console.log(`TV show updated: ${tv.title}`)
      }
    } else {
      console.log(`No file server data found for TV show: ${tv.title}`)
    }
  }

  // Iterate through movies
  for (const movie of currentDB.movies) {
    const fileServerMovieData = fileServer?.movies[movie.title]
    const fileServerMovieDataURLS = fileServerMovieData.urls

    if (fileServerMovieData) {
      const updateData = {}

      // Update posterBlurhash URL if it exists
      if (
        fileServerMovieDataURLS?.posterBlurhash &&
        (!movie.posterBlurhash ||
          fileServerMovieDataURLS?.posterBlurhash !==
            movie.posterBlurhash.replace(fileServerURLWithoutPrefixPath, ''))
      ) {
        updateData.posterBlurhash =
          fileServerURLWithoutPrefixPath + fileServerMovieDataURLS.posterBlurhash
        console.log(`Movie: Updating posterBlurhash for ${movie.title}`)
      }

      if (Object.keys(updateData).length > 0) {
        await client
          .db('Media')
          .collection('Movies')
          .updateOne({ title: movie.title }, { $set: updateData })

        // Update the MediaUpdatesMovie collection
        await updateMediaUpdates(movie.title, 'movie')
        console.log(`Movie updated: ${movie.title}`)
      }
    } else {
      console.log(`No file server data found for movie: ${movie.title}`)
    }
  }

  console.log(chalk.bold.green('Blurhash synchronization complete.'))
}

/**
 * Sync the length and dimensions properties of TV shows and movies between the
 * admin frontend database and the file server.
 */
export async function syncLengthAndDimensions(currentDB, fileServer) {
  const client = await clientPromise

  console.log(chalk.bold.greenBright('Starting length and dimensions synchronization...'))
  // Iterate through TV shows
  for (const tv of currentDB.tv) {
    // Retrieve the file server show data
    const fileServerShowData = fileServer?.tv[tv.title]

    // Iterate through seasons
    for (const season of tv.seasons) {
      // Retrieve the file server season data
      const fileServerSeasonData = fileServerShowData.seasons[`Season ${season.seasonNumber}`]
      const fileServerSeasonDataFILENAMES = fileServerSeasonData?.fileNames

      if (fileServerSeasonDataFILENAMES) {
        // Iterate through episodes
        for (const episode of season.episodes) {
          // Find the corresponding episode file in the fileServer data
          const episodeFileName = fileServerSeasonDataFILENAMES.find((fileName) => {
            const fileNameWithoutExtension = fileName.slice(0, -4) // Remove the file extension
            const episodeNumberRegex = new RegExp(
              `S\\d{2}E${episode.episodeNumber.toString().padStart(2, '0')}`,
              'i'
            )
            return episodeNumberRegex.test(fileNameWithoutExtension)
          })

          // If episode file found in file server data
          if (episodeFileName) {
            const updateData = {}

            if (
              fileServerSeasonData.lengths[episodeFileName] &&
              episode.length !== fileServerSeasonData.lengths[episodeFileName]
            ) {
              updateData['seasons.$.episodes.$[episode].length'] =
                fileServerSeasonData.lengths[episodeFileName]
            }

            if (
              fileServerSeasonData.dimensions[episodeFileName] &&
              episode.dimensions !== fileServerSeasonData.dimensions[episodeFileName]
            ) {
              updateData['seasons.$.episodes.$[episode].dimensions'] =
                fileServerSeasonData.dimensions[episodeFileName]
            }

            if (Object.keys(updateData).length > 0) {
              console.log(
                `TV: Updating length and dimensions for ${tv.title} - Season ${season.seasonNumber}, Episode ${episode.episodeNumber}`
              )
              await client
                .db('Media')
                .collection('TV')
                .updateOne(
                  {
                    title: tv.title,
                    'seasons.seasonNumber': season.seasonNumber,
                    'seasons.episodes.episodeNumber': episode.episodeNumber,
                  },
                  {
                    $set: updateData,
                  },
                  {
                    arrayFilters: [{ 'episode.episodeNumber': episode.episodeNumber }],
                  }
                )
            }
          }
        }
      } else {
        console.log(`No file server data found for TV show: ${tv.title}`)
      }
    }
  }

  // Iterate through movies
  for (const movie of currentDB.movies) {
    // Retrieve the file server movie data
    const fileServerMovieData = fileServer?.movies[movie.title]
    const fileServerMovieDataFILENAMES = fileServerMovieData?.fileNames

    if (fileServerMovieDataFILENAMES) {
      // Find the MP4 file
      const mp4File = fileServerMovieDataFILENAMES.find((name) => name.endsWith('.mp4'))

      if (mp4File) {
        const updateData = {}

        if (
          fileServerMovieData.length[mp4File] &&
          movie.length !== fileServerMovieData.length[mp4File]
        ) {
          updateData.length = fileServerMovieData.length[mp4File]
        }

        if (
          fileServerMovieData.dimensions[mp4File] &&
          movie.dimensions !== fileServerMovieData.dimensions[mp4File]
        ) {
          updateData.dimensions = fileServerMovieData.dimensions[mp4File]
        }

        if (Object.keys(updateData).length > 0) {
          console.log(`Movie: Updating length and dimensions for ${movie.title}`)
          await client.db('Media').collection('Movies').updateOne(
            {
              title: movie.title,
            },
            {
              $set: updateData,
            }
          )
        }
      }
    } else {
      console.log(`No file server data found for movie: ${movie.title}`)
    }
  }
  console.log(chalk.bold.greenBright('Length and dimensions synchronization complete.'))
}

/**
 * Syncs episode thumbnail URLs and blurhash between the current database and file server
 * @param {Object} currentDB - The current database
 * @param {Object} fileServer - The file server data
 * @returns {Promise} - Resolves when sync is complete
 */
export async function syncEpisodeThumbnails(currentDB, fileServer) {
  const client = await clientPromise
  console.log(chalk.bold.magentaBright('Starting episode thumbnail synchronization...'))

  // Iterate through TV shows
  for (const tv of currentDB.tv) {
    // Retrieve the file server show data
    const fileServerShowData = fileServer?.tv[tv.title]

    // Iterate through seasons
    for (const season of tv.seasons) {
      // Retrieve the file server season data
      const fileServerSeasonData = fileServerShowData.seasons[`Season ${season.seasonNumber}`]
      const fileServerSeasonDataURLS = fileServerSeasonData?.urls

      // Iterate through episodes
      for (const episode of season.episodes) {
        // Construct the episode file name based on a pattern or directly from the fileServer data
        const episodeFileName = Object.keys(fileServerSeasonDataURLS).find((fileName) => {
          const fileNameWithoutExtension = fileName.slice(0, -4) // Remove the file extension
          const episodeNumberRegex = new RegExp(
            `S\\d{2}E${episode.episodeNumber.toString().padStart(2, '0')}`,
            'i'
          )
          return episodeNumberRegex.test(fileNameWithoutExtension)
        })

        // If episode file found in file server data
        if (episodeFileName) {
          const fileServerEpisodeData = fileServerSeasonDataURLS[episodeFileName]

          const thumbnailUrl = episode.thumbnail ? episode.thumbnail : null
          const sanitizedThumbnailUrl =
            thumbnailUrl && thumbnailUrl.replaceAll(fileServerURLWithoutPrefixPath, '')
          //
          const blurhashURL = episode.thumbnailBlurhash ? episode.thumbnailBlurhash : null
          const sanitizedBlurhashThumbnailUrl =
            blurhashURL && blurhashURL.replaceAll(fileServerURLWithoutPrefixPath, '')

          // Check if the file server thumbnail URL is different from the current thumbnail URL
          const thumbnailURLNeedsUpdate =
            fileServerEpisodeData.thumbnail &&
            fileServerEpisodeData.thumbnail !== sanitizedThumbnailUrl

          const thumbnailURLNeedsRemove = episode.thumbnail && !fileServerEpisodeData.thumbnail

          // Check if the file server thumbnail blurhash is different from the current blurhash
          const thumbnailBlurhashNeedsUpdate =
            fileServerEpisodeData.thumbnailBlurhash &&
            fileServerEpisodeData.thumbnailBlurhash !== sanitizedBlurhashThumbnailUrl

          const thumbnailBlurhashNeedsRemove =
            episode.thumbnailBlurhash && !fileServerEpisodeData.thumbnailBlurhash

          // If either URL needs to be updated or removed
          // To allow a user to manually update any missing
          // thumbnail URLs or blurhashes we have commented out
          // thumbnailURLNeedsRemove and thumbnailBlurhashNeedsRemove
          if (
            thumbnailUrl !== undefined &&
            (thumbnailURLNeedsUpdate || thumbnailBlurhashNeedsUpdate) /* ||
                thumbnailURLNeedsRemove ||
                thumbnailBlurhashNeedsRemove */
          ) {
            console.log(
              `TV: Updating thumbnail URLs for ${tv.title} - Season ${season.seasonNumber}, Episode ${episode.episodeNumber}`
            )

            const updateFields = {}
            const unsetFields = {}

            if (thumbnailURLNeedsUpdate) {
              updateFields['seasons.$.episodes.$[episode].thumbnail'] =
                `${fileServerURLWithoutPrefixPath}${fileServerEpisodeData.thumbnail}`
            } else if (thumbnailURLNeedsRemove) {
              unsetFields['seasons.$.episodes.$[episode].thumbnail'] = ''
            }

            if (thumbnailBlurhashNeedsUpdate) {
              updateFields['seasons.$.episodes.$[episode].thumbnailBlurhash'] =
                `${fileServerURLWithoutPrefixPath}${fileServerEpisodeData.thumbnailBlurhash}`
            } else if (thumbnailBlurhashNeedsRemove) {
              unsetFields['seasons.$.episodes.$[episode].thumbnailBlurhash'] = ''
            }

            const updateOperation = {}
            if (Object.keys(updateFields).length > 0) {
              updateOperation.$set = updateFields
            }
            if (Object.keys(unsetFields).length > 0) {
              updateOperation.$unset = unsetFields
            }

            await client
              .db('Media')
              .collection('TV')
              .updateOne(
                {
                  title: tv.title,
                  'seasons.seasonNumber': season.seasonNumber,
                  'seasons.episodes.episodeNumber': episode.episodeNumber,
                },
                updateOperation,
                {
                  arrayFilters: [{ 'episode.episodeNumber': episode.episodeNumber }],
                }
              )
          }
        }
      }
    }
  }
  console.log(chalk.bold.magentaBright('Episode thumbnail synchronization complete.'))
}

/**
 * Syncs poster URLs between the current database and file server
 * @param {Object} currentDB - The current database
 * @param {Object} fileServer - The file server data
 * @returns {Promise} - Resolves when sync is complete
 */
export async function syncPosterURLs(currentDB, fileServer) {
  const client = await clientPromise
  console.log(chalk.bold.magenta('Starting poster URL synchronization...'))

  // Sync TV shows and seasons
  for (const tv of currentDB.tv) {
    const fileServerShowData = fileServer?.tv[tv.title]

    if (fileServerShowData) {
      const updateData = {}

      // Update show poster URL
      if (
        fileServerShowData.posterURL &&
        (!tv.posterURL ||
          fileServerShowData.posterURL !== tv.posterURL.replace(fileServerURLWithoutPrefixPath, ''))
      ) {
        updateData.posterURL = fileServerURLWithoutPrefixPath + fileServerShowData.posterURL
        console.log(`TV: Updating posterURL for ${tv.title}`)
      }

      // Update season poster URLs
      if (tv.seasons && fileServerShowData.seasons) {
        const updatedSeasons = tv.seasons.map((season) => {
          const fileServerSeasonData = fileServerShowData.seasons[`Season ${season.seasonNumber}`]
          if (
            fileServerSeasonData &&
            fileServerSeasonData.season_poster &&
            (!season.season_poster ||
              fileServerSeasonData.season_poster !==
                season.season_poster.replace(fileServerURLWithoutPrefixPath, ''))
          ) {
            console.log(
              `TV Season: Updating posterURL for ${tv.title} Season ${season.seasonNumber}`
            )
            return {
              ...season,
              season_poster: fileServerURLWithoutPrefixPath + fileServerSeasonData.season_poster,
            }
          }
          return season
        })

        // Only update seasons if there are changes
        if (JSON.stringify(updatedSeasons) !== JSON.stringify(tv.seasons)) {
          updateData.seasons = updatedSeasons
        }
      }

      if (Object.keys(updateData).length > 0) {
        await client
          .db('Media')
          .collection('TV')
          .updateOne({ title: tv.title }, { $set: updateData })

        // Update the MediaUpdatesTV collection
        await updateMediaUpdates(tv.title, 'tv')
        console.log(`TV show updated: ${tv.title}`)
      }
    } else {
      console.log(`No file server data found for TV show: ${tv.title}`)
    }
  }

  // Sync movies
  for (const movie of currentDB.movies) {
    const fileServerMovieData = fileServer?.movies[movie.title]
    const fileServerMovieDataURLS = fileServerMovieData?.urls

    if (fileServerMovieData) {
      const updateData = {}

      // Update movie poster URL
      if (
        fileServerMovieDataURLS?.posterURL &&
        (!movie.posterURL ||
          fileServerMovieDataURLS?.posterURL !==
            movie.posterURL.replace(fileServerURLWithoutPrefixPath, ''))
      ) {
        updateData.posterURL = fileServerURLWithoutPrefixPath + fileServerMovieDataURLS.posterURL
        console.log(`Movie: Updating posterURL for ${movie.title}`)
      }

      if (Object.keys(updateData).length > 0) {
        await client
          .db('Media')
          .collection('Movies')
          .updateOne({ title: movie.title }, { $set: updateData })

        // Update the MediaUpdatesTV collection
        await updateMediaUpdates(movie.title, 'movie')
        console.log(`Movie updated: ${movie.title}`)
      }
    } else {
      console.log(`No file server data found for movie: ${movie.title}`)
    }
  }

  console.log(chalk.bold.magenta('Poster URL synchronization complete.'))
}

/**
 * Syncs backdrop URLs between the current database and file server
 * @param {Object} currentDB - The current database
 * @param {Object} fileServer - The file server data
 * @returns {Promise} - Resolves when sync is complete
 */
export async function syncBackdrop(currentDB, fileServer) {
  const client = await clientPromise
  console.log(chalk.bold.redBright('Starting backdrop URL synchronization...'))

  // Sync TV shows and seasons
  for (const tv of currentDB.tv) {
    const fileServerShowData = fileServer?.tv[tv.title]

    if (fileServerShowData) {
      const updateData = {}

      // Update show backdrop URL
      if (
        fileServerShowData.backdrop &&
        (!tv.backdrop ||
          fileServerShowData.backdrop !== tv.backdrop.replace(fileServerURLWithoutPrefixPath, ''))
      ) {
        updateData.backdrop = fileServerURLWithoutPrefixPath + fileServerShowData.backdrop
        console.log(`TV: Updating backdrop for ${tv.title}`)
      }

      // Update show backdrop URL
      if (
        fileServerShowData.backdropBlurhash &&
        (!tv.backdropBlurhash ||
          fileServerShowData.backdropBlurhash !==
            tv.backdropBlurhash.replace(fileServerURLWithoutPrefixPath, ''))
      ) {
        updateData.backdropBlurhash =
          fileServerURLWithoutPrefixPath + fileServerShowData.backdropBlurhash
        console.log(`TV: Updating backdropBlurhash for ${tv.title}`)
      }

      if (Object.keys(updateData).length > 0) {
        await client
          .db('Media')
          .collection('TV')
          .updateOne({ title: tv.title }, { $set: updateData })

        // Update the MediaUpdatesTV collection
        await updateMediaUpdates(tv.title, 'tv')
        console.log(`TV show updated: ${tv.title}`)
      }
    } else {
      console.log(`No file server data found for TV show: ${tv.title}`)
    }
  }

  // Sync movies
  for (const movie of currentDB.movies) {
    const fileServerMovieData = fileServer?.movies[movie.title]
    const fileServerMovieDataURLS = fileServerMovieData?.urls

    if (fileServerMovieData) {
      const updateData = {}

      // Update movie backdrop URL
      if (
        fileServerMovieDataURLS?.backdrop &&
        (!movie.backdrop ||
          fileServerMovieDataURLS.backdrop !==
            movie.backdrop.replace(fileServerURLWithoutPrefixPath, ''))
      ) {
        updateData.backdrop =
          fileServerURLWithoutPrefixPath + fileServerMovieDataURLS.backdropBlurhash
        console.log(`Movie: Updating backdrop for ${movie.title}`)
      }

      // Update movie backdropBlurhash URL
      if (
        fileServerMovieDataURLS?.backdropBlurhash &&
        (!movie.backdropBlurhash ||
          fileServerMovieDataURLS.backdropBlurhash !==
            movie.backdropBlurhash.replace(fileServerURLWithoutPrefixPath, ''))
      ) {
        updateData.backdropBlurhash =
          fileServerURLWithoutPrefixPath + fileServerMovieDataURLS.backdropBlurhash
        console.log(`Movie: Updating backdropBlurhash for ${movie.title}`)
      }

      if (Object.keys(updateData).length > 0) {
        await client
          .db('Media')
          .collection('Movies')
          .updateOne({ title: movie.title }, { $set: updateData })

        // Update the MediaUpdatesTV collection
        await updateMediaUpdates(movie.title, 'movie')
        console.log(`Movie updated: ${movie.title}`)
      }
    } else {
      console.log(`No file server data found for movie: ${movie.title}`)
    }
  }

  console.log(chalk.bold.redBright('Poster URL synchronization complete.'))
}

export async function updateLastSynced() {
  const client = await clientPromise
  const result = await client
    .db('app_config')
    .collection('syncInfo')
    .updateOne({ _id: 'lastSyncTime' }, { $set: { timestamp: new Date() } }, { upsert: true })
  return result
}
