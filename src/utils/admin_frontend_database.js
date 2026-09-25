// Server-side helpers for the sync pipeline. Deliberately not 'use server':
// nothing here should be callable from a browser. The Users page's actions
// live in src/utils/actions/admin_users.js.

import clientPromise from '@src/lib/mongodb'

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
