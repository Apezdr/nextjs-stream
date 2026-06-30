import clientPromise from '../lib/mongodb'
import { userQueries } from '@src/lib/userQueries'

export async function getAllUsers() {
  const users = await userQueries.findAll()
  return users
}

export async function getLastSynced() {
  const client = await clientPromise

  // ex. 2025-03-30T00:52:11.483+00:00
  const lastSyncTime = await client
    .db('app_config')
    .collection('syncInfo')
    .findOne({ _id: 'lastSyncTime' })

  if (!lastSyncTime || !lastSyncTime?.timestamp) {
    return null
  }

  return lastSyncTime.timestamp || null
}

export class AutoSyncManager {
  async getAutoSync() {
    const client = await clientPromise
    const autoSync = await client
      .db('app_config')
      .collection('settings')
      .findOne({ name: 'autoSync' })
    return autoSync.value
  }

  async setAutoSync(autoSync) {
    const client = await clientPromise
    await client
      .db('app_config')
      .collection('settings')
      .updateOne({ name: 'autoSync' }, { $set: { value: autoSync } }, { upsert: true })
    return autoSync
  }
}

const AUTO_CAPTIONS_DEFAULTS = Object.freeze({
  enabled: false,
  languages: ['en'],
  model: 'base.en',
  threads: 4,
  maxConcurrent: 1,
})

export class AutoCaptionsManager {
  async getAutoCaptions() {
    const client = await clientPromise
    const doc = await client
      .db('app_config')
      .collection('settings')
      .findOne({ name: 'autoCaptions' })
    return { ...AUTO_CAPTIONS_DEFAULTS, ...(doc?.value || {}) }
  }

  async setAutoCaptions({ enabled, languages }) {
    const client = await clientPromise
    const update = {}
    if (typeof enabled === 'boolean') update['value.enabled'] = enabled
    if (Array.isArray(languages)) update['value.languages'] = languages
    if (Object.keys(update).length === 0) return
    await client
      .db('app_config')
      .collection('settings')
      .updateOne(
        { name: 'autoCaptions' },
        { $set: update, $setOnInsert: { name: 'autoCaptions' } },
        { upsert: true }
      )
  }
}

export class SyncAggressivenessManager {
  async getSyncAggressiveness() {
    const client = await clientPromise
    const autoSync = await client
      .db('app_config')
      .collection('settings')
      .findOne({ name: 'syncAggressiveness' })
    return autoSync.value
  }

  async setSyncAggressiveness(syncAggressiveness) {
    const client = await clientPromise
    await client
      .db('app_config')
      .collection('settings')
      .updateOne(
        { name: 'syncAggressiveness' },
        { $set: { value: syncAggressiveness } },
        { upsert: true }
      )
    return syncAggressiveness
  }
}
