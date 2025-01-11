'use server'

import { ObjectId } from 'mongodb'
import clientPromise from '@src/lib/mongodb'
import { updateMetadata } from '@src/utils/admin_database'

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
  const recordID = new ObjectId(id)
  const record = await client.db('Media').collection(collection).findOne({ _id: recordID })
  record._id = record._id.toString()
  return record
}

/**
 * Updates the MediaUpdates collection with the last updated timestamp for a given media title.
 *
 * @param {string} title - The title of the media (show or movie).
 * @param {string} type - The type of the media ('movie' or 'tv').
 */
export async function updateMediaUpdates(title, type) {
  const client = await clientPromise
  const collectionName = type === 'movie' ? 'MediaUpdatesMovie' : 'MediaUpdatesTV'
  await client
    .db('Media')
    .collection(collectionName)
    .updateOne({ title }, { $set: { lastUpdated: new Date() } }, { upsert: true })

  return true
}

/**
 * Deletes a record from the MediaUpdates collection by title and type.
 *
 * @param {string} title - The title of the media (show or movie).
 * @param {string} type - The type of the media ('movie' or 'tv').
 */
export async function deleteMediaUpdates(title, type) {
  const client = await clientPromise
  const collectionName = type === 'movie' ? 'MediaUpdatesMovie' : 'MediaUpdatesTV'
  await client.db('Media').collection(collectionName).deleteOne({ title })
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

  let isBeingAdded
  try {
    isBeingAdded = JSON.parse(formData.get('record')).action === 'add'
  } catch (error) {
    console.error('Invalid JSON in formData:', error)
    isBeingAdded = false
  }
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

  // Extract locked fields
  const lockedFields = Array.from(formData.keys())
    .filter((key) => key.startsWith('locked_'))
    .reduce((acc, key) => {
      const fieldName = key.replace('locked_', '')
      const isLocked = formData.get(key) === 'true'
      if (isLocked) {
        acc[fieldName] = true
      }
      return acc
    }, {})
  // Prepare an object to hold the updates or new record
  let updateQuery = {}
  let unsetQuery = {} // For fields to remove

  const rawFormData = {}

  if (formData.get('title')) {
    rawFormData.title = formData.get('title')
  }

  if (formData.get('videoURL')) {
    rawFormData.videoURL = formData.get('videoURL')
  }

  if (captionURLsData && Object.keys(captionURLsData).length > 0) {
    rawFormData.captionURLs = captionURLsData
  } else if (originalRecord?.captionURLs && !captionURLsEntries.length) {
    unsetQuery.captionURLs = ''
  }

  if (formData.get('posterURL')) {
    rawFormData.posterURL = formData.get('posterURL')
  }
  if (formData.get('posterBlurhash')) {
    rawFormData.posterBlurhash = formData.get('posterBlurhash')
  }
  if (formData.get('tmdb_id')) {
    if (!rawFormData.metadata) rawFormData.metadata = {}
    rawFormData.metadata.id = formData.get('tmdb_id')
  }
  if (formData.get('chapterURL')) {
    rawFormData.chapterURL = formData.get('chapterURL')
  } else if (originalRecord?.chapterURL && formData.get('chapterURL') === '') {
    unsetQuery.chapterURL = ''
  }

  // Compare the original record with the new data, if editing
  if (!isBeingAdded && originalRecord) {
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
    rawFormData.mediaLastModified = new Date()
    // If adding a new record, use all fields from rawFormData
    updateQuery = rawFormData
  }

  // Handle lockedFields
  if (lockedFields && Object.keys(lockedFields).length > 0) {
    updateQuery.lockedFields = lockedFields
  } else {
    unsetQuery.lockedFields = ''
  }

  if (!isBeingAdded && originalRecord && originalRecord.videoURL !== rawFormData.videoURL) {
    // Update the mediaLastModified field
    updateQuery.mediaLastModified = new Date()
  } else if (rawFormData.videoURL) {
    rawFormData.mediaLastModified = new Date()
  }

  // If editing, update the record, else insert a new record
  if (!isBeingAdded && recordId) {
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
        await updateMetadata({
          type: 'movie',
          media_title: rawFormData.title,
          tmdb_id: rawFormData.metadata.id,
        })

      console.log(`Record with ID ${recordId} updated in collection ${collection}.`)

      // Update the MediaUpdatesMovie collection
      await updateMediaUpdates(rawFormData.title, 'movie')
    } else {
      console.log('No changes to update.')
    }
  } else {
    // Insert a new record
    const newRecordId = await client.db('Media').collection(collection).insertOne(rawFormData)
    console.log(`New record added with ID ${newRecordId.insertedId} to collection ${collection}.`)
    await updateMetadata({
      type: 'movie',
      media_title: rawFormData.title,
      tmdb_id: rawFormData.metadata.id,
    })

    // Update the MediaUpdatesMovie collection
    await updateMediaUpdates(rawFormData.title, 'movie')
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

    // Update the MediaUpdatesTV collection
    await updateMediaUpdates(tvSeriesData.title, 'tv')
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

    // Update the MediaUpdatesTV collection
    await updateMediaUpdates(tvSeriesData.title, 'tv')
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

  // Retrieve the title of the record to delete
  const record = await client
    .db('Media')
    .collection(collection)
    .findOne({ _id: new ObjectId(recordId) })
  if (!record) {
    console.log(`No record found with ID ${recordId} in collection ${collection}.`)
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

      // Delete the corresponding entry in the MediaUpdatesMovie or MediaUpdatesTV collection
      await deleteMediaUpdates(record.title, formData.get('type'))
    } else {
      console.log(`No record found with ID ${recordId} in collection ${collection}.`)
    }
  } catch (error) {
    console.error('Error deleting record:', error)
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
