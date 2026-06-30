'use server'

import clientPromise from '@src/lib/mongodb'
import { userQueries } from '@src/lib/userQueries'

/**
 * Updates the MediaUpdates collection with the last updated timestamp for a given media title.
 * Still used by the live sync pipeline (sync/*.js, sync_utils.js).
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

export async function updateUserLimitedAccessFlag({ limitedAccess = false, userID }) {
  if (userID) {
    const users = await userQueries.updateById(userID, { limitedAccess })
    return users
  }
  return false
}

export async function updateUserApprovedFlag({ approved = false, userID }) {
  if (userID) {
    const users = await userQueries.updateById(userID, { approved })
    return users
  }
  return false
}
