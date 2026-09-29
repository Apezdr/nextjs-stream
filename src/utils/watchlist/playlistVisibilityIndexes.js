import clientPromise from '@src/lib/mongodb'

// Memoized per process (flag set only on success) so polling requests don't
// pay createIndex round trips — mirrors ensureWatchlistIndexes.
let playlistVisibilityIndexesEnsured = false

/**
 * Ensure indexes for Users.PlaylistVisibility, shared by database.js and
 * homeRows.js, which both write it:
 * - unique (userId, playlistId)
 * - secondary on playlistId
 * - compound to support showInApp queries
 */
export async function ensurePlaylistVisibilityIndexes() {
  if (playlistVisibilityIndexesEnsured) return
  try {
    const client = await clientPromise
    const usersDb = client.db('Users')
    const coll = usersDb.collection('PlaylistVisibility')

    // Unique compound index (userId, playlistId)
    await coll.createIndex(
      { userId: 1, playlistId: 1 },
      { name: 'unique_user_playlist_visibility', unique: true }
    )

    // Secondary index for admin-wide operations on a playlist
    await coll.createIndex({ playlistId: 1 }, { name: 'by_playlistId' })

    // Index to support frequent "showInApp=1 for userId" queries with ordering
    await coll.createIndex(
      { userId: 1, showInApp: 1, appOrder: 1, dateUpdated: -1 },
      { name: 'by_user_showInApp_appOrder' }
    )

    playlistVisibilityIndexesEnsured = true
  } catch (e) {
    if (process.env.DEBUG === 'true') {
      console.warn('[PlaylistVisibility] Index ensure warning:', e?.message || e)
    }
    // Continue; indexes may already exist
  }
}
