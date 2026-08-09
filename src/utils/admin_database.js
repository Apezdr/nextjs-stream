import clientPromise from '../lib/mongodb'
import { userQueries } from '@src/lib/userQueries'
import { DEFAULT_APP_TIME_ZONE, normalizeTimeZone } from '@src/utils/dateTime'

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

const JIT_SERVE_DEFAULTS = Object.freeze({
  // null = no runtime override; the serve layer falls back to the
  // JIT_SERVE_MODE env var (and its own 'rescue' default).
  mode: null,
  // null = no queue ceiling override; falls back to JIT_SERVE_MAX_QUEUED.
  maxQueued: null,
})

export class JitServeSettingsManager {
  async getJitServeSettings() {
    const client = await clientPromise
    const doc = await client
      .db('app_config')
      .collection('settings')
      .findOne({ name: 'jitServe' })
    return { ...JIT_SERVE_DEFAULTS, ...(doc?.value || {}) }
  }

  async setJitServeSettings({ mode, maxQueued }) {
    const client = await clientPromise
    const update = {}
    // mode: 'off' | 'rescue' | 'prefer' sets an override; null clears it
    // (follow env). Anything else is a caller bug — reject upstream.
    if (mode === null || ['off', 'rescue', 'prefer'].includes(mode)) {
      update['value.mode'] = mode
    }
    if (maxQueued === null || (Number.isInteger(maxQueued) && maxQueued >= 0)) {
      update['value.maxQueued'] = maxQueued
    }
    if (Object.keys(update).length === 0) return
    await client
      .db('app_config')
      .collection('settings')
      .updateOne(
        { name: 'jitServe' },
        { $set: update, $setOnInsert: { name: 'jitServe' } },
        { upsert: true }
      )
  }
}

export class ServerDisplayNameManager {
  async getServerDisplayNames() {
    const client = await clientPromise
    const doc = await client
      .db('app_config')
      .collection('settings')
      .findOne({ name: 'serverDisplayNames' })
    return doc?.value && typeof doc.value === 'object' ? doc.value : {}
  }

  async setServerDisplayName(serverId, displayName) {
    if (serverId !== 'default' && !/^server\d+$/.test(serverId)) {
      throw new Error('Invalid server ID')
    }

    const client = await clientPromise
    const collection = client.db('app_config').collection('settings')
    if (displayName) {
      await collection.updateOne(
        { name: 'serverDisplayNames' },
        {
          $set: { [`value.${serverId}`]: displayName },
          $setOnInsert: { name: 'serverDisplayNames' },
        },
        { upsert: true }
      )
    } else {
      // Clearing a label restores the derived fallback without mutating the
      // load-bearing ID stored throughout sync and field provenance.
      await collection.updateOne(
        { name: 'serverDisplayNames' },
        { $unset: { [`value.${serverId}`]: '' } }
      )
    }
  }
}

export class LocalAccessSettingsManager {
  async getEnabled() {
    const client = await clientPromise
    const doc = await client
      .db('app_config')
      .collection('settings')
      .findOne({ name: 'localAccess' })
    // Off unless explicitly turned on — this one weakens authentication.
    return doc?.value?.enabled === true
  }

  async setEnabled(enabled) {
    const client = await clientPromise
    await client
      .db('app_config')
      .collection('settings')
      .updateOne(
        { name: 'localAccess' },
        { $set: { 'value.enabled': enabled === true }, $setOnInsert: { name: 'localAccess' } },
        { upsert: true }
      )
  }
}

export class SyncServerLatencySettingsManager {
  async getEnabled() {
    const client = await clientPromise
    const doc = await client
      .db('app_config')
      .collection('settings')
      .findOne({ name: 'syncServerLatency' })
    return doc?.value?.enabled !== false
  }

  async setEnabled(enabled) {
    const client = await clientPromise
    await client
      .db('app_config')
      .collection('settings')
      .updateOne(
        { name: 'syncServerLatency' },
        { $set: { 'value.enabled': enabled }, $setOnInsert: { name: 'syncServerLatency' } },
        { upsert: true }
      )
  }
}

export class AppTimeZoneManager {
  async getTimeZone() {
    const client = await clientPromise
    const doc = await client
      .db('app_config')
      .collection('settings')
      .findOne({ name: 'appTimeZone' })
    return normalizeTimeZone(doc?.value) || DEFAULT_APP_TIME_ZONE
  }

  async setTimeZone(timeZone) {
    const normalized = normalizeTimeZone(timeZone)
    if (!normalized) throw new Error('Invalid IANA time zone')
    const client = await clientPromise
    await client
      .db('app_config')
      .collection('settings')
      .updateOne(
        { name: 'appTimeZone' },
        { $set: { value: normalized }, $setOnInsert: { name: 'appTimeZone' } },
        { upsert: true }
      )
    return normalized
  }
}

export class SystemPerformanceAlertSettingsManager {
  async getEnabled() {
    const client = await clientPromise
    const doc = await client
      .db('app_config')
      .collection('settings')
      .findOne({ name: 'systemPerformanceAlerts' })
    return doc?.value?.enabled !== false
  }

  async setEnabled(enabled) {
    const client = await clientPromise
    await client
      .db('app_config')
      .collection('settings')
      .updateOne(
        { name: 'systemPerformanceAlerts' },
        { $set: { 'value.enabled': enabled }, $setOnInsert: { name: 'systemPerformanceAlerts' } },
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
