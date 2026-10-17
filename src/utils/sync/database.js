export async function updateLastSynced(client) {
  try {
    const result = await client
      .db('app_config')
      .collection('syncInfo')
      .updateOne({ _id: 'lastSyncTime' }, { $set: { timestamp: new Date() } }, { upsert: true })
    return result
  } catch (error) {
    console.error('Error updating last synced timestamp:', error)
    // Return error object instead of throwing
    return {
      error: {
        message: error.message,
        stack: error.stack
      }
    }
  }
}
