'use server'

import { ObjectId } from 'mongodb'
import clientPromise from '../lib/mongodb'
import { updateMetadata } from './admin_database'
import { addOrUpdateSeason, fetchMetadata, sanitizeRecord } from './admin_utils'
import isEqual from 'lodash/isEqual'
import { fileServerURL } from './config'

/**
 * Get a record from the database by type and id
 * @param {Object} params - An object containing the type and id of the record to fetch
 * @param {string} params.type - The type of the record (e.g. 'season')
 * @param {string} params.id - The id of the record to fetch
 * @returns {Object} The record document from the database
 */
export async function getRecord({ type, id }) {
  const client = await clientPromise
  const collection = type === 'movie' ? 'Movies' : 'TV'
  const record = await client
    .db('Media')
    .collection(collection)
    .findOne({ _id: new ObjectId(id) })
  record._id = record._id.toString()
  return record
}

/**
 * Gets posters for movies or TV shows.
 *
 * @param {string} type - The type of media (movie or TV).
 * @returns {Promise} Resolves to an array of poster objects.
 */
export async function getPosters(type) {
  const client = await clientPromise
  const collection = type === 'movie' ? 'Movies' : 'TV'

  let records
  if (type === 'movie') {
    records = await client
      .db('Media')
      .collection(collection)
      .find(
        {},
        {
          projection: {
            title: 1,
            //metadata: 1,
            posterURL: 1,
            posterBlurhash: 1,
          },
        }
      )
      .hint({ _id: 1 })
      .toArray()
  } else if (type === 'tv') {
    records = await client
      .db('Media')
      .collection(collection)
      .find(
        {},
        {
          projection: {
            title: 1,
            //metadata: 1,
            posterURL: 1,
            posterBlurhash: 1,
            'metadata.genres': 1,
            'metadata.networks': 1,
            'metadata.status': 1,
            'metadata.seasons.length': 1,
            'metadata.seasons.overview': 1,
            'seasons.seasonNumber': 1,
            'seasons.season_poster': 1,
            'seasons.seasonPosterBlurhash': 1,
          },
        }
      )
      .hint({ _id: 1 })
      .toArray()
  }

  return await Promise.all(
    records.map(async (record) => {
      let poster = record.posterURL || record.metadata?.poster_path
      if (!poster) {
        poster = null
      }
      if (record._id) {
        record._id = record._id.toString()
      }
      if (record.posterBlurhash) {
        record.posterBlurhash = await fetchMetadata(record.posterBlurhash, 'blurhash')
      }
      return {
        id: record._id.toString(),
        posterURL: poster,
        posterBlurhash: record.posterBlurhash || null,
        title: record.title || null,
        link: encodeURIComponent(record.title) || null,
        type: type,
        metadata: record.metadata || null,
        media: record,
      }
    })
  )
}

/**
 * Get the most recently watched media for the current user.
 *
 * @param {string} userId - The ID of the current user.
 * @returns {Promise<Array>} The recently watched media details.
 */
export async function getRecentlyWatchedForUser(userId) {
  try {
    const client = await clientPromise
    const user = await client
      .db('Users')
      .collection('AuthenticatedUsers')
      .findOne({ _id: new ObjectId(userId) })

    if (!user) {
      throw new Error(`User with ID ${userId} not found`)
    }

    const lastWatched = await client
      .db('Media')
      .collection('PlaybackStatus')
      .aggregate(
        [
          { $match: { userId: user._id } },
          { $unwind: '$videosWatched' },
          { $sort: { 'videosWatched.lastUpdated': -1 } },
          { $limit: 200 },
          { $group: { _id: '$userId', videosWatched: { $push: '$videosWatched' } } },
        ],
        { hint: 'userId_1' }
      )
      .toArray()

    if (lastWatched.length === 0 || !lastWatched[0].videosWatched) {
      return null
    }

    const videoIds = lastWatched[0].videosWatched.map((video) => video.videoId)
    const uniqueVideoIds = [...new Set(videoIds)]

    // Bulk fetch movies and TV shows
    const [movies, tvShows] = await Promise.all([
      client
        .db('Media')
        .collection('Movies')
        .find({ videoURL: { $in: uniqueVideoIds } })
        .sort({ videoURL: -1 })
        .hint({ videoURL: -1 })
        .toArray(),
      client
        .db('Media')
        .collection('TV')
        .find({ 'seasons.episodes.videoURL': { $in: uniqueVideoIds } })
        .sort({ 'seasons.episodes.videoURL': -1 })
        .hint({ 'seasons.episodes.videoURL': -1 })
        .toArray(),
    ])

    const movieMap = new Map(movies.map((movie) => [movie.videoURL, movie]))
    const tvMap = new Map()

    tvShows.forEach((tvShow) => {
      tvShow.seasons.forEach((season) => {
        season.episodes.forEach((episode) => {
          if (uniqueVideoIds.includes(episode.videoURL)) {
            tvMap.set(episode.videoURL, { ...tvShow, episode })
          }
        })
      })
    })

    const watchedDetails = await Promise.all(
      lastWatched[0].videosWatched.map(async (video) => {
        const movie = movieMap.get(video.videoId)
        if (movie) {
          return sanitizeRecord(movie, 'movie', video)
        }
        const tvDetails = tvMap.get(video.videoId)
        if (tvDetails) {
          const detailedTVShow = await extractTVShowDetailsFromMap(tvDetails, video.videoId)
          if (detailedTVShow) {
            return sanitizeRecord(detailedTVShow, 'tv', video)
          }
        }
        return null
      })
    )

    const filtered = watchedDetails.filter((detail) => detail !== null && detail !== undefined)
    return filtered
  } catch (error) {
    console.error(`Error in getRecentlyWatchedForUser: ${error.message}`)
    throw error
  }
}

/**
 * Saves changes made in the movie modal form.
 *
 * @export
 * @async
 * @function saveMovieModalChanges
 * @param {object} formData - The data from the movie modal form
 */
export async function saveMovieModalChanges(formData) {
  // Connect to the database
  const client = await clientPromise

  const originalRecord = formData.get('record') ? JSON.parse(formData.get('record')) : null
  const recordId = originalRecord?._id ? originalRecord._id : null
  const collection = 'Movies'

  // Retrieve other form data
  const captionURLsEntries = formData.getAll('captionURLs')
  const captionURLsData = captionURLsEntries.reduce((acc, entry) => {
    const parsedEntry = JSON.parse(entry)
    const [label, details] = Object.entries(parsedEntry)[0]
    acc[label] = details
    return acc
  }, {})

  // Prepare an object to hold the updates or new record
  let updateQuery = {}
  let unsetQuery = {} // For fields to remove

  const rawFormData = {
    title: formData.get('title'),
    videoURL: formData.get('videoURL'),
    captionURLs: captionURLsData,
    // ... other fields ...
  }

  if (formData.get('posterURL')) {
    rawFormData.posterURL = formData.get('posterURL')
  }
  if (formData.get('posterBlurhash')) {
    rawFormData.posterBlurhash = formData.get('posterBlurhash')
  }
  if (formData.get('chapterURL')) {
    rawFormData.chapterURL = formData.get('chapterURL')
  } else if (originalRecord?.chapterURL && formData.get('chapterURL') === '') {
    unsetQuery.chapterURL = ''
  }

  // Compare the original record with the new data, if editing
  if (originalRecord) {
    for (let key in rawFormData) {
      if (
        Object.prototype.hasOwnProperty.call(rawFormData, key) &&
        rawFormData[key] !== undefined
      ) {
        if (key === 'captionURLs' && Object.keys(rawFormData[key]).length === 0) {
          unsetQuery[key] = '' // Prepare to unset captionURLs
        } else if (JSON.stringify(originalRecord[key]) !== JSON.stringify(rawFormData[key])) {
          updateQuery[key] = rawFormData[key] // Update field
        }
      }
    }
  } else {
    // If adding a new record, use all fields from rawFormData
    updateQuery = rawFormData
  }

  // If editing, update the record, else insert a new record
  if (recordId) {
    // Check if there are changes to update
    if (Object.keys(updateQuery).length > 0 || Object.keys(unsetQuery).length > 0) {
      let updateOperation = {}
      if (Object.keys(updateQuery).length > 0) {
        updateOperation['$set'] = updateQuery
      }
      if (Object.keys(unsetQuery).length > 0) {
        updateOperation['$unset'] = unsetQuery
      }

      // Update the existing record
      await client
        .db('Media')
        .collection(collection)
        .updateOne({ _id: new ObjectId(recordId) }, updateOperation)

      // Update metadata if there is no metadata or if there is an error in the current metadata
      if (
        !originalRecord.metadata ||
        originalRecord?.metadata.Error ||
        originalRecord?.metadata?.runtime == 0
      )
        await updateMetadata({ type: 'movie', media_title: rawFormData.title })

      console.log(`Record with ID ${recordId} updated in collection ${collection}.`)
    } else {
      console.log('No changes to update.')
    }
  } else {
    // Insert a new record
    const newRecordId = await client.db('Media').collection(collection).insertOne(rawFormData)
    console.log(`New record added with ID ${newRecordId.insertedId} to collection ${collection}.`)
    await updateMetadata({ type: 'movie', media_title: rawFormData.title })
  }
}

/**
 * Saves changes made in the TV series modal form.
 *
 * @param {Object} formData - The data from the form.
 */
export async function saveTVSeriesModalChanges(formData) {
  // Connect to the database
  const client = await clientPromise

  const originalRecord = formData.get('record') ? JSON.parse(formData.get('record')) : null
  const recordId = originalRecord ? originalRecord._id : null
  const collection = 'TV' // Assuming 'TV' is the collection name

  // Parse seasons and episodes from formData
  const updatedSeasonsMap = {}

  formData.forEach((value, key) => {
    let match = key.match(/^episode(Record|Title|URL|Number)-(\d+)-(\d+)$/)
    if (match) {
      const [, type, seasonIndex, episodeIndex] = match
      const seasonNum = parseInt(seasonIndex, 10) + 1
      const episodeNum = parseInt(episodeIndex, 10)

      // Ensure the season and episode array is initialized
      if (!updatedSeasonsMap[seasonNum]) {
        updatedSeasonsMap[seasonNum] = {
          seasonNumber: seasonNum,
          episodes: [],
          ...originalRecord.seasons[seasonNum - 1],
        }
      }

      // Initialize the episode object if it does not exist yet
      if (!updatedSeasonsMap[seasonNum].episodes[episodeNum]) {
        updatedSeasonsMap[seasonNum].episodes[episodeNum] = {}
      }

      // Get a reference to the episode object
      let episode = updatedSeasonsMap[seasonNum].episodes[episodeNum]

      switch (type) {
        case 'Record': {
          const recordData = JSON.parse(value)
          // Apply record data but ensure not to overwrite existing specific updates
          Object.keys(recordData).forEach((key) => {
            if (episode[key] === undefined) {
              // Only update if the key is not already set
              episode[key] = recordData[key]
            }
          })
          break
        }
        case 'Title':
          episode.title = value
          break
        case 'URL':
          episode.videoURL = value
          break
        case 'Number':
          episode.episodeNumber = parseInt(value, 10)
          break
      }
    }
  })

  // Convert updatedSeasonsMap to array
  const updatedSeasons = Object.keys(updatedSeasonsMap).map((key) => updatedSeasonsMap[key])

  // Destructure the original record to remove the _id and type fields
  const { _id, type, ...tvSeriesData } = originalRecord
  // Overwrite the original show title with the new title from the form
  tvSeriesData.title = formData.get('title')
  // Overwrite the original seasons with the updated seasons/episodes from the form
  tvSeriesData.seasons = updatedSeasons

  if (recordId) {
    // Update existing record
    await client
      .db('Media')
      .collection(collection)
      .updateOne({ _id: new ObjectId(recordId) }, { $set: tvSeriesData })
    console.log(`TV series with ID ${recordId} updated in collection ${collection}.`)
    tvSeriesData._id = recordId // Set the id for the metadata call
    if (!originalRecord.metadata || originalRecord?.metadata.Error) {
      await updateMetadata({
        type: 'tv',
        media_title: tvSeriesData.title,
        tvSeriesData: tvSeriesData,
      })
    }
  } else {
    // Add new record
    const newRecordId = await client.db('Media').collection(collection).insertOne(tvSeriesData)
    console.log(
      `New TV series added with ID ${newRecordId.insertedId} to collection ${collection}.`
    )

    // Update metadata for the new TV series
    tvSeriesData._id = newRecordId.insertedId // Set the new ID to tvSeriesData
    await updateMetadata({
      type: 'tv',
      media_title: tvSeriesData.title,
      tvSeriesData: tvSeriesData,
    })
  }
}

/**
 * Deletes a record from the database by ID.
 *
 * @param {Object} formData - The form data containing the record ID.
 */
export async function deleteRecordById(formData) {
  // Connect to the database
  const client = await clientPromise

  // Retrieve the record ID from formData
  const recordId = formData.get('id')
  const collection = formData.get('type') === 'tv' ? 'TV' : 'Movies' // Assuming 'TV' and 'Movies' are the collection names

  // Validate the recordId
  if (!recordId) {
    console.log('No record ID provided for deletion.')
    return
  }

  // Delete the record in MongoDB
  try {
    const result = await client
      .db('Media')
      .collection(collection)
      .deleteOne({ _id: new ObjectId(recordId) })

    if (result.deletedCount === 1) {
      console.log(`Record with ID ${recordId} successfully deleted from collection ${collection}.`)
    } else {
      console.log(`No record found with ID ${recordId} in collection ${collection}.`)
    }
  } catch (error) {
    console.error('Error deleting record:', error)
  }
}

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
    const movieData = fileServer.movies[movieTitle]

    // Find the MP4 file
    const mp4File = movieData.fileNames.find((name) => name.endsWith('.mp4'))

    if (!mp4File) {
      console.log(`Movie: No MP4 file found for ${movieTitle}. Skipping.`)
      continue
    }

    // Make a GET request to retrieve movie metadata from file server
    const movieMetadata = await fetchMetadata(movieData.urls.metadata, 'file')

    if (!movieMetadata) {
      return console.log(`Movie: No metadata found for ${movieData}. Skipping.`)
    }
    if (typeof movieMetadata.release_date !== 'object') {
      movieMetadata.release_date = new Date(movieMetadata.release_date)
    }

    // Initialize update data
    let updateData = {
      title: movieTitle,
      videoURL: fileServerURL + `${movieData.urls.mp4}`,
      mediaLastModified: new Date(movieData.urls.mediaLastModified),
      length: movieData.length[mp4File],
      dimensions: movieData.dimensions[mp4File],
      metadata: movieMetadata,
    }

    // Add captionURLs for available subtitles
    if (movieData.urls?.subtitles) {
      const subtitleURLs = {}
      for (const [langName, subtitleData] of Object.entries(movieData.urls.subtitles)) {
        subtitleURLs[langName] = {
          srcLang: subtitleData.srcLang,
          url: fileServerURL + `${subtitleData.url}`,
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

    if (movieData.urls?.poster) {
      updateData.posterURL = fileServerURL + `${movieData.urls.poster}`
    }
    // Add posterBlurhash URL if it exists
    if (movieData.urls?.posterBlurhash) {
      updateData.posterBlurhash = fileServerURL + `${movieData.urls.posterBlurhash}`
    }
    // Some movies have a logo image
    if (movieData.urls?.logo) {
      updateData.logo = fileServerURL + `${movieData.urls.logo}`
    }
    // Add chapterURL if chapters file exists
    if (movieData.urls?.chapters) {
      updateData.chapterURL = fileServerURL + `${movieData.urls.chapters}`
    }

    await client
      .db('Media')
      .collection('Movies')
      .updateOne({ title: movieTitle }, { $set: updateData }, { upsert: true })
    //await updateMetadata({ type: 'movie', media_title: movieTitle })
  }

  // Sync TV Shows
  for (const missingShow of missingMedia.tv) {
    const showTitle = missingShow.showTitle
    const showData = fileServer.tv[showTitle]

    // Make a GET request to retrieve show-level metadata
    const showMetadata = await fetchMetadata(showData.metadata)

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
      posterURL: fileServerURL + `${showData.poster}`,
      posterBlurhash: fileServerURL + `${posterBlurhash}`,
      backdrop: fileServerURL + `${showData.backdrop}`,
      backdropBlurhash: fileServerURL + `${backdropBlurhash}`,
    }

    if (showData.logo) {
      showUpdateData.logo = fileServerURL + `${showData.logo}`
    }

    await client
      .db('Media')
      .collection('TV')
      .updateOne({ title: showTitle }, { $set: showUpdateData }, { upsert: true })
    //await updateMetadata({ type: 'tv', media_title: showTitle, tvSeriesData: currentShow });
  }
}

/**
 *
 * @param {Object} fileServer - The data structure representing media available on the file server.
 * @param {Object} currentDB - The current state of the media database.
 *
 */
export async function syncMetadata(currentDB, fileServer) {
  try {
    const client = await clientPromise
    // Sync Movies
    for (const movie of currentDB.movies) {
      // Set the file server movie data
      const fileServer_movieData = fileServer.movies[movie.title]
      // Set the current DB movie data
      const currentDB_movieData = movie
      // Make a GET request to retrieve movie-level metadata
      const movieMetadata = await fetchMetadata(fileServer_movieData.urls.metadata)

      movieMetadata.release_date = new Date(movieMetadata.release_date)
      // First check the last updated date of the movie metadata
      if (movieMetadata.last_updated > currentDB_movieData.metadata?.last_updated) {
        // Update movie metadata
        console.log('Movie: Updating movie metadata', movie.title)
        await client
          .db('Media')
          .collection('Movies')
          .updateOne({ title: movie.title }, { $set: { metadata: movieMetadata } })
      }
    }
    // Sync TV
    let tv_metadata = {
      name: '',
    }
    for (const tv of currentDB.tv) {
      // Set the file server show data
      const fileServer_showData = fileServer.tv[tv.title]
      // Set the current DB show data
      const currentDB_showData = tv
      // Make a GET request to retrieve show-level metadata
      const mostRecent_showMetadata = await fetchMetadata(fileServer_showData.metadata)

      if (mostRecent_showMetadata.name !== tv_metadata.name) {
        tv_metadata = structuredClone(mostRecent_showMetadata)
      }
      // Store the Current DB Season - Episode Data
      var currentDB_memory_season = {}

      // First check the last updated date of the show metadata
      if (
        new Date(mostRecent_showMetadata.last_updated) >
        new Date(currentDB_showData.metadata?.last_updated ?? '2024-01-01T01:00:00.000000')
      ) {
        // Update show metadata
        console.log('TV: Updating show metadata', tv.title)
        await client
          .db('Media')
          .collection('TV')
          .updateOne({ title: tv.title }, { $set: { metadata: mostRecent_showMetadata } })
      }

      // Then check the last updated date of the season metadata
      for await (const season of currentDB_showData.seasons) {
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

        let seasonNeedsUpdate = false

        // Create a Set to store the episode numbers of existing episodes in currentDB
        const existingEpisodeNumbers = new Set(
          currentDB_memory_season.metadata.episodes.map((episode) => episode.episode_number)
        )

        for await (const episodeFileName of fileServer_seasonData.fileNames) {
          const episodeData = fileServer_seasonData.urls[episodeFileName]
          const mostRecent_episodeMetadata = await fetchMetadata(episodeData.metadata)

          if (!mostRecent_episodeMetadata) {
            console.error('TV: Metadata fetch failed for', episodeFileName, episodeData.metadata)
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
                new Date(currentDB_episodeMetadata?.last_updated ?? '2024-01-01T01:00:00.000000')
            ) {
              // Logic to update this episode's metadata in currentDB
              console.log(
                `TV: Updating episode metadata for ${episodeFileName} in ${tv.title}, Season ${currentDB_memory_season.seasonNumber}`
              )

              tv_metadata = {
                ...tv_metadata,
                seasons: tv_metadata.seasons.map((season) => {
                  if (season.season_number === currentDB_memory_season.seasonNumber) {
                    currentDB_memory_season.metadata.episodes =
                      currentDB_memory_season.metadata.episodes.map((episode) => {
                        if (episode.episode_number === mostRecent_episodeMetadata.episode_number) {
                          seasonNeedsUpdate = true
                          console.log(
                            'TV: --Updating episode metadata',
                            tv.title,
                            `Season ${currentDB_memory_season.seasonNumber} E${episode.episode_number}`,
                            mostRecent_episodeMetadata
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
        }

        if (seasonNeedsUpdate) {
          console.log('tv_metadata', tv_metadata)
        }

        if (
          new Date(mostRecent_showMetadata.seasons?.last_updated) >
          new Date(
            currentDB_memory_season.metadata.episodes?.last_updated ?? '2024-01-01T01:00:00.000000'
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
              { arrayFilters: [{ 'elem.seasonNumber': currentDB_memory_season.seasonNumber }] }
            )
        }
      }
    }
  } catch (error) {
    console.error('Error in syncMetadata:', error)
    throw error // Rethrow the error to be handled by the calling function
  }
}

/**
 *
 * @param {Object} fileServer - The data structure representing media available on the file server.
 * @param {Object} currentDB - The current state of the media database.
 *
 */
export async function syncCaptions(currentDB, fileServer) {
  const client = await clientPromise

  // Iterate through TV shows
  for (const tv of currentDB.tv) {
    // Retrieve the file server show data
    const fileServerShowData = fileServer.tv[tv.title]

    // Iterate through seasons
    for (const season of tv.seasons) {
      // Retrieve the file server season data
      const fileServerSeasonData = fileServerShowData.seasons[`Season ${season.seasonNumber}`]

      // Iterate through episodes
      for (const episode of season.episodes) {
        // Construct the episode file name based on a pattern or directly from the fileServer data
        const episodeFileName = Object.keys(fileServerSeasonData.urls).find((fileName) => {
          const fileNameWithoutExtension = fileName.slice(0, -4) // Remove the file extension
          const episodeNumberRegex = new RegExp(
            `S\\d{2}E${episode.episodeNumber.toString().padStart(2, '0')}`,
            'i'
          )
          return episodeNumberRegex.test(fileNameWithoutExtension)
        })

        // If episode file found in file server data
        if (episodeFileName) {
          const fileServerEpisodeData = fileServerSeasonData.urls[episodeFileName]

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
                    url: fileServerURL + subtitleData.url,
                    srcLang: subtitleData.srcLang,
                    lastModified: subtitleData.lastModified,
                  }
                }
              } else {
                // If lastModified is not available, add the subtitle data
                updatedCaptionsURLs[langName] = {
                  url: fileServerURL + subtitleData.url,
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
            }
          }
        }
      }
    }
  }

  // Iterate through movies
  for (const movie of currentDB.movies) {
    // Retrieve the file server movie data
    const fileServerMovieData = fileServer.movies[movie.title]

    // If there are subtitles data
    if (fileServerMovieData.urls?.subtitles) {
      const updatedCaptionsURLs = { ...movie.captionURLs } // Create a copy of existing captions

      // Iterate through subtitles and update captionURLs
      for (const [langName, subtitleData] of Object.entries(fileServerMovieData.urls.subtitles)) {
        // Check if the subtitle data has a lastModified property
        if (subtitleData.lastModified) {
          // Compare the lastModified date with the existing date in the movie's captionURLs
          const existingSubtitle = movie.captionURLs?.[langName]
          if (
            !existingSubtitle ||
            new Date(subtitleData.lastModified) > new Date(existingSubtitle.lastModified)
          ) {
            updatedCaptionsURLs[langName] = {
              url: fileServerURL + subtitleData.url,
              srcLang: subtitleData.srcLang,
              lastModified: subtitleData.lastModified,
            }
          }
        } else {
          // If lastModified is not available, add the subtitle data
          updatedCaptionsURLs[langName] = {
            url: fileServerURL + subtitleData.url,
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
        }
      }
    }
  }
}

/**
 * Sync subtitles/chapters from a file server to the current database.
 *
 * @param {Object} currentDB - The database to sync chapters to
 * @param {Object} fileServer - The file server to fetch chapter data from
 */
export async function syncChapters(currentDB, fileServer) {
  const client = await clientPromise

  // Iterate through TV shows
  for (const tv of currentDB.tv) {
    // Retrieve the file server show data or default to empty if not present
    const fileServerShowData = fileServer.tv[tv.title] || { seasons: {} }

    // Iterate through seasons
    for (const season of tv.seasons) {
      // Retrieve the file server season data or default to empty object if not present
      const fileServerSeasonData = fileServerShowData.seasons[`Season ${season.seasonNumber}`] || {
        urls: {},
      }

      // Iterate through episodes
      for (const episode of season.episodes) {
        // Determine the existence of episode file based on expected naming convention
        const episodeFileName = Object.keys(fileServerSeasonData.urls).find((fileName) => {
          const fileNameWithoutExtension = fileName.slice(0, -4) // Remove the file extension
          const episodeNumberRegex = new RegExp(
            `S\\d{2}E${episode.episodeNumber.toString().padStart(2, '0')}`,
            'i'
          )
          return episodeNumberRegex.test(fileNameWithoutExtension)
        })

        const fileServerEpisodeData = episodeFileName
          ? fileServerSeasonData.urls[episodeFileName]
          : null

        // Handle updating or removing chapter URLs based on file server data
        if (fileServerEpisodeData && fileServerEpisodeData.chapters) {
          const chaptersURL = fileServerURL + fileServerEpisodeData.chapters

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

  // Iterate through movies
  for (const movie of currentDB.movies) {
    // Retrieve the file server movie data or default to empty if not present
    const fileServerMovieData = fileServer.movies[movie.title] || { urls: {} }

    // If there is a chapters URL
    if (fileServerMovieData.urls.chapters) {
      const chaptersURL = fileServerURL + fileServerMovieData.urls.chapters

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
}

/**
 * Syncs video URLs between the current database and file server
 * @param {Object} currentDB - The current database
 * @param {Object} fileServer - The file server data
 * @returns {Promise} - Resolves when sync is complete
 */
export async function syncVideoURL(currentDB, fileServer) {
  const client = await clientPromise

  // Iterate through TV shows
  for (const tv of currentDB.tv) {
    // Retrieve the file server show data
    const fileServerShowData = fileServer.tv[tv.title]

    // Iterate through seasons
    for (const season of tv.seasons) {
      // Retrieve the file server season data
      const fileServerSeasonData = fileServerShowData.seasons[`Season ${season.seasonNumber}`]

      // Iterate through episodes
      for (const episode of season.episodes) {
        // Construct the episode file name based on a pattern or directly from the fileServer data
        const episodeFileName = Object.keys(fileServerSeasonData.urls).find((fileName) => {
          const fileNameWithoutExtension = fileName.slice(0, -4) // Remove the file extension
          const episodeNumberRegex = new RegExp(
            `S\\d{2}E${episode.episodeNumber.toString().padStart(2, '0')}`,
            'i'
          )
          return episodeNumberRegex.test(fileNameWithoutExtension)
        })

        // If episode file found in file server data
        if (episodeFileName) {
          const fileServerEpisodeData = fileServerSeasonData.urls[episodeFileName]

          // If the file server video URL is different from the current video URL
          if (fileServerEpisodeData.videourl !== episode.videoURL.replace(fileServerURL, '')) {
            console.log(
              `TV: Updating video URL for ${tv.title} - Season ${season.seasonNumber}, Episode ${episode.episodeNumber}`
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
                      fileServerURL + fileServerEpisodeData.videourl,
                  },
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

  // Iterate through movies
  for (const movie of currentDB.movies) {
    // Retrieve the file server movie data
    const fileServerMovieData = fileServer.movies[movie.title]

    // If the file server video URL is different from the current video URL
    if (
      fileServerMovieData.urls?.mp4 &&
      fileServerMovieData.urls.mp4 !== movie.videoURL.replace(fileServerURL, '')
    ) {
      console.log(`Movie: Updating video URL for ${movie.title}`)
      await client
        .db('Media')
        .collection('Movies')
        .updateOne(
          {
            title: movie.title,
          },
          {
            $set: {
              videoURL: fileServerURL + fileServerMovieData.urls.mp4,
            },
          }
        )
    }
  }
}

/**
 * Syncs logo urls between the current database and file server
 * @param {Object} currentDB - The current database
 * @param {Object} fileServer - The file server data
 * @returns {Promise} - Resolves when sync is complete
 */
export async function syncLogos(currentDB, fileServer) {
  const client = await clientPromise

  // Iterate through TV shows
  for (const tv of currentDB.tv) {
    // Retrieve the file server show data
    const fileServerShowData = fileServer.tv[tv.title]

    if (fileServerShowData?.logo) {
      if (!tv.logo || fileServerShowData.logo !== tv.logo.replace(fileServerURL, '')) {
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
                logo: fileServerURL + fileServerShowData.logo,
              },
            }
          )
      }
    }
  }

  // Iterate through movies
  for (const movie of currentDB.movies) {
    // Retrieve the file server movie data
    const fileServerMovieData = fileServer.movies[movie.title]

    // If the file server video poster is different from the current posterURL
    if (fileServerMovieData.urls?.logo)
      if (!movie.logo || fileServerMovieData.urls.logo !== movie.logo.replace(fileServerURL, '')) {
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
                logo: fileServerURL + fileServerMovieData.urls.logo,
              },
            }
          )
      }
  }
}

/**
 * Syncs blurhash image urls between the current database and file server
 * @param {Object} currentDB - The current database
 * @param {Object} fileServer - The file server data
 * @returns {Promise} - Resolves when sync is complete
 */
export async function syncBlurhash(currentDB, fileServer) {
  const client = await clientPromise
  console.log('Starting blurhash synchronization...')

  // Iterate through TV shows
  for (const tv of currentDB.tv) {
    const fileServerShowData = fileServer.tv[tv.title]

    if (fileServerShowData) {
      const updateData = {}

      // Update posterBlurhash URL if it exists
      if (
        fileServerShowData.posterBlurhash &&
        (!tv.posterBlurhash ||
          fileServerShowData.posterBlurhash !== tv.posterBlurhash.replace(fileServerURL, ''))
      ) {
        updateData.posterBlurhash = fileServerURL + fileServerShowData.posterBlurhash
        console.log(`TV: Updating posterBlurhash for ${tv.title}`)
      }

      // Update backdropBlurhash URL if it exists
      if (
        fileServerShowData.backdropBlurhash &&
        (!tv.backdropBlurhash ||
          fileServerShowData.backdropBlurhash !== tv.backdropBlurhash.replace(fileServerURL, ''))
      ) {
        updateData.backdropBlurhash = fileServerURL + fileServerShowData.backdropBlurhash
        console.log(`TV: Updating backdropBlurhash for ${tv.title}`)
      }

      if (Object.keys(updateData).length > 0) {
        await client
          .db('Media')
          .collection('TV')
          .updateOne({ title: tv.title }, { $set: updateData })
        console.log(`TV show updated: ${tv.title}`)
      }
    } else {
      console.log(`No file server data found for TV show: ${tv.title}`)
    }
  }

  // Iterate through movies
  for (const movie of currentDB.movies) {
    const fileServerMovieData = fileServer.movies[movie.title]

    if (fileServerMovieData) {
      const updateData = {}

      // Update posterBlurhash URL if it exists
      if (
        fileServerMovieData.urls?.posterBlurhash &&
        (!movie.posterBlurhash ||
          fileServerMovieData.urls.posterBlurhash !==
            movie.posterBlurhash.replace(fileServerURL, ''))
      ) {
        updateData.posterBlurhash = fileServerURL + fileServerMovieData.urls.posterBlurhash
        console.log(`Movie: Updating posterBlurhash for ${movie.title}`)
      }

      if (Object.keys(updateData).length > 0) {
        await client
          .db('Media')
          .collection('Movies')
          .updateOne({ title: movie.title }, { $set: updateData })
        console.log(`Movie updated: ${movie.title}`)
      }
    } else {
      console.log(`No file server data found for movie: ${movie.title}`)
    }
  }

  console.log('Blurhash synchronization complete.')
}

/**
 * Sync the length and dimensions properties of TV shows and movies between the
 * admin frontend database and the file server.
 */
export async function syncLengthAndDimensions(currentDB, fileServer) {
  const client = await clientPromise

  // Iterate through TV shows
  for (const tv of currentDB.tv) {
    // Retrieve the file server show data
    const fileServerShowData = fileServer.tv[tv.title]

    // Iterate through seasons
    for (const season of tv.seasons) {
      // Retrieve the file server season data
      const fileServerSeasonData = fileServerShowData.seasons[`Season ${season.seasonNumber}`]

      // Iterate through episodes
      for (const episode of season.episodes) {
        // Find the corresponding episode file in the fileServer data
        const episodeFileName = fileServerSeasonData.fileNames.find((fileName) => {
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
    }
  }

  // Iterate through movies
  for (const movie of currentDB.movies) {
    // Retrieve the file server movie data
    const fileServerMovieData = fileServer.movies[movie.title]

    // Find the MP4 file
    const mp4File = fileServerMovieData.fileNames.find((name) => name.endsWith('.mp4'))

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
  }
}

/**
 * Syncs episode thumbnail URLs and blurhash between the current database and file server
 * @param {Object} currentDB - The current database
 * @param {Object} fileServer - The file server data
 * @returns {Promise} - Resolves when sync is complete
 */
export async function syncEpisodeThumbnails(currentDB, fileServer) {
  const client = await clientPromise

  // Iterate through TV shows
  for (const tv of currentDB.tv) {
    // Retrieve the file server show data
    const fileServerShowData = fileServer.tv[tv.title]

    // Iterate through seasons
    for (const season of tv.seasons) {
      // Retrieve the file server season data
      const fileServerSeasonData = fileServerShowData.seasons[`Season ${season.seasonNumber}`]

      // Iterate through episodes
      for (const episode of season.episodes) {
        // Construct the episode file name based on a pattern or directly from the fileServer data
        const episodeFileName = Object.keys(fileServerSeasonData.urls).find((fileName) => {
          const fileNameWithoutExtension = fileName.slice(0, -4) // Remove the file extension
          const episodeNumberRegex = new RegExp(
            `S\\d{2}E${episode.episodeNumber.toString().padStart(2, '0')}`,
            'i'
          )
          return episodeNumberRegex.test(fileNameWithoutExtension)
        })

        // If episode file found in file server data
        if (episodeFileName) {
          const fileServerEpisodeData = fileServerSeasonData.urls[episodeFileName]

          const thumbnailUrl = episode.thumbnail ? episode.thumbnail : null
          const sanitizedThumbnailUrl = thumbnailUrl && thumbnailUrl.replaceAll(fileServerURL, '')

          // Check if the file server thumbnail URL is different from the current thumbnail URL
          const thumbnailURLNeedsUpdate =
            fileServerEpisodeData.thumbnail &&
            fileServerEpisodeData.thumbnail !== sanitizedThumbnailUrl

          // Check if the file server thumbnail blurhash is different from the current blurhash
          const thumbnailBlurhashNeedsUpdate =
            `${fileServerURL}${fileServerEpisodeData.thumbnailBlurhash}` !==
            `${episode.thumbnailBlurhash}`

          // If either URL needs to be updated
          if (
            thumbnailUrl !== undefined &&
            (thumbnailURLNeedsUpdate || thumbnailBlurhashNeedsUpdate)
          ) {
            console.log(
              `TV: Updating thumbnail URLs for ${tv.title} - Season ${season.seasonNumber}, Episode ${episode.episodeNumber}`
            )

            const updateFields = {}
            if (thumbnailURLNeedsUpdate) {
              updateFields['seasons.$.episodes.$[episode].thumbnail'] =
                `${fileServerURL}${fileServerEpisodeData.thumbnail}`
            }
            if (thumbnailBlurhashNeedsUpdate) {
              updateFields['seasons.$.episodes.$[episode].thumbnailBlurhash'] =
                `${fileServerURL}${fileServerEpisodeData.thumbnailBlurhash}`
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
                {
                  $set: updateFields,
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
}

export async function updateUserLimitedAccessFlag({ limitedAccess = false, userID }) {
  if (userID) {
    const client = await clientPromise
    const users = await client
      .db('Users')
      .collection('AuthenticatedUsers')
      .updateOne({ _id: new ObjectId(userID) }, { $set: { limitedAccess: limitedAccess } })
    return users
  }
  return false
}

export async function updateUserApprovedFlag({ approved = false, userID }) {
  if (userID) {
    const client = await clientPromise
    const users = await client
      .db('Users')
      .collection('AuthenticatedUsers')
      .updateOne({ _id: new ObjectId(userID) }, { $set: { approved: approved } })
    return users
  }
  return false
}

/**
 * Extract detailed TV show information from the pre-fetched data.
 *
 * @param {Object} tvDetails - The pre-fetched TV show details.
 * @param {string} videoId - The video URL.
 * @returns {Promise<Object|null>} The detailed TV show information or null if not found.
 */
async function extractTVShowDetailsFromMap(tvDetails, videoId) {
  const { title: showTitle, seasons } = tvDetails
  const [_, showPath] = videoId?.split('/tv/') ?? [null, null]
  const parts = showPath?.split('/')
  let returnData = {}

  if (parts?.length < 3) {
    return null
  }

  const showTitleDecoded = decodeURIComponent(parts[0].replace(/_/g, ' '))
  const seasonPartDecoded = decodeURIComponent(parts[1])
  const episodeFileNameDecoded = decodeURIComponent(parts[2])

  const seasonNumber = parseInt(seasonPartDecoded.match(/\d+/)[0])

  const season = seasons.find((s) => s.seasonNumber === seasonNumber)
  if (!season) {
    return null
  }

  const episode = season.episodes.find((e) => e.videoURL === videoId)
  if (!episode) {
    return null
  }

  returnData = {
    _id: tvDetails._id,
    showTitle: showTitleDecoded,
    showTitleFormatted: `${showTitleDecoded} S${seasonNumber
      .toString()
      .padStart(2, '0')}E${episode.episodeNumber.toString().padStart(2, '0')}`,
    seasonNumber,
    seasons: seasons,
    posterURL: episode.thumbnail ?? '/sorry-image-not-available.jpg',
    metadata: tvDetails.metadata,
    episode,
  }

  if (tvDetails.logo) {
    returnData.logo = tvDetails.logo
  }

  if (episode.thumbnailBlurhash) {
    returnData.posterBlurhash = episode.thumbnailBlurhash
  }

  return returnData
}

export async function extractTVShowDetails(client, videoId) {
  const [_, showPath] = videoId?.split('/tv/') ?? [null, null]
  const parts = showPath?.split('/')
  let returnData = {}

  // Will have to consider how to extract information
  // from a youtube video link etc.
  // For now it'll omit them from the result
  if (parts?.length < 3) {
    // Invalid URL structure
    return null
  }

  const showTitle = decodeURIComponent(parts[0].replace(/_/g, ' '))
  const seasonPart = decodeURIComponent(parts[1])
  const episodeFileName = decodeURIComponent(parts[2])

  const seasonNumber = parseInt(seasonPart.match(/\d+/)[0]) // Extract number from "Season X"

  const show = await client.db('Media').collection('TV').findOne({ title: showTitle })
  if (!show) {
    return null
  }

  const season = show.seasons.find((s) => s.seasonNumber === seasonNumber)
  if (!season) {
    return null
  }

  const episode = season.episodes.find((e) => e.videoURL === videoId)
  if (!episode) {
    return null
  }

  returnData = {
    _id: show._id,
    showTitle: showTitle,
    showTitleFormatted: `${showTitle} S${seasonNumber
      .toString()
      .padStart(2, '0')}E${episode.episodeNumber.toString().padStart(2, '0')}`,
    seasonNumber,
    seasons: show.seasons,
    posterURL: episode.thumbnail ?? '/sorry-image-not-available.jpg',
    metadata: show.metadata,
    episode,
  }

  if (show.logo) {
    returnData.logo = show.logo
  }

  if (episode.thumbnailBlurhash) {
    returnData.posterBlurhash = episode.thumbnailBlurhash
  }

  return returnData
}

export async function updateLastSynced() {
  const client = await clientPromise
  const result = await client
    .db('app_config')
    .collection('syncInfo')
    .updateOne({ _id: 'lastSyncTime' }, { $set: { timestamp: new Date() } }, { upsert: true })
  return result
}
