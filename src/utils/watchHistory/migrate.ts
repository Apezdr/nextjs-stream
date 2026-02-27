/**
 * Watch History Migration
 * 
 * Automatic migration from PlaybackStatus (old schema) to WatchHistory (new schema)
 * Called on app startup via instrumentation.ts
 * 
 * This is a safe, idempotent migration that:
 * - Only runs if WatchHistory doesn't exist or is incomplete
 * - Uses upsert to prevent duplicates
 * - Preserves original PlaybackStatus data as fallback
 * - Logs progress and errors
 */

import clientPromise from '@src/lib/mongodb'
import { ObjectId } from 'mongodb'
import { createLogger } from '@src/lib/logger'
import crypto from 'crypto'

const log = createLogger('WatchHistory.Migration')

declare global {
  // Prevent double-init in dev / hot reload
  // eslint-disable-next-line no-var
  var __watchHistoryMigrationStarted: boolean | undefined
}

/**
 * Generate normalized video ID from URL
 */
function generateNormalizedVideoId(videoId: string): string {
  return crypto.createHash('sha256').update(videoId).digest('hex').substring(0, 16)
}

/**
 * Migrate a single user's playback data from PlaybackStatus to WatchHistory
 */
async function migrateUserPlayback(
  userDoc: any,
  watchHistoryCollection: any
): Promise<number> {
  const { userId, videosWatched } = userDoc

  if (!videosWatched || !Array.isArray(videosWatched) || videosWatched.length === 0) {
    return 0
  }

  let migratedCount = 0

  for (const video of videosWatched) {
    try {
      const normalizedVideoId = video.normalizedVideoId || generateNormalizedVideoId(video.videoId)

      const watchHistoryDoc: any = {
        userId,
        videoId: video.videoId,
        normalizedVideoId,
        playbackTime: video.playbackTime || 0,
        lastUpdated: video.lastUpdated || new Date(),
        isValid: video.isValid !== undefined ? video.isValid : null,
        lastScanned: video.lastScanned || null,
        mediaType: video.mediaType || null,
        mediaId: video.mediaId || null,
        deviceInfo: video.deviceInfo || null
      }

      // Add TV-specific fields if present
      if (video.mediaType === 'tv') {
        if (video.showId) watchHistoryDoc['showId'] = video.showId
        if (video.seasonNumber) watchHistoryDoc['seasonNumber'] = video.seasonNumber
        if (video.episodeNumber) watchHistoryDoc['episodeNumber'] = video.episodeNumber
      }

      // Upsert with compound key to prevent duplicates
      await watchHistoryCollection.updateOne(
        { userId, normalizedVideoId },
        { $set: watchHistoryDoc },
        { upsert: true }
      )

      migratedCount++
    } catch (error) {
      log.error({ error, videoId: video.videoId, userId }, 'Failed to migrate video')
    }
  }

  return migratedCount
}

/**
 * Create indexes on WatchHistory collection
 */
async function createWatchHistoryIndexes(db: any): Promise<void> {
  const collection = db.collection('WatchHistory')

  const indexes = [
    { key: { userId: 1, normalizedVideoId: 1 }, unique: true, name: 'userId_normalizedId_unique' },
    { key: { userId: 1 }, name: 'userId_index' },
    { key: { normalizedVideoId: 1 }, name: 'normalizedVideoId_index' },
    { key: { userId: 1, lastUpdated: -1 }, name: 'userId_lastUpdated_index' }
  ]

  for (const indexSpec of indexes) {
    try {
      await collection.createIndex(indexSpec.key, {
        name: indexSpec.name,
        unique: indexSpec.unique || false
      })
    } catch (error: any) {
      // Index already exists - this is fine
      if (error.code !== 85 && error.code !== 86) {
        log.warn({ error, indexName: indexSpec.name }, 'Failed to create index')
      }
    }
  }
}

/**
 * Main migration function - runs on app startup
 * Safe to call multiple times (idempotent)
 */
export async function migratePlaybackStatusIfNeeded(): Promise<void> {
  // Prevent double-init in dev / hot reload
  if (globalThis.__watchHistoryMigrationStarted) {
    return
  }
  globalThis.__watchHistoryMigrationStarted = true

  try {
    const client = await clientPromise
    const db = client.db('Media')

    // Check if migration is needed
    const watchHistoryCount = await db.collection('WatchHistory').countDocuments()
    const playbackStatusCount = await db.collection('PlaybackStatus').countDocuments()

    // If WatchHistory already has data close to PlaybackStatus count, skip migration
    if (watchHistoryCount > 0 && watchHistoryCount >= playbackStatusCount * 0.8) {
      log.info(
        { watchHistoryCount, playbackStatusCount },
        'WatchHistory already migrated, skipping migration'
      )
      return
    }

    if (playbackStatusCount === 0) {
      // No data to migrate
      log.info('No PlaybackStatus data to migrate')
      return
    }

    log.info({ playbackStatusCount }, 'Starting PlaybackStatus to WatchHistory migration...')

    // Create indexes first
    await createWatchHistoryIndexes(db)

    // Migrate data in batches
    const playbackStatusCollection = db.collection('PlaybackStatus')
    const watchHistoryCollection = db.collection('WatchHistory')

    // Fetch all users in batches
    const cursor = playbackStatusCollection.find({});
    let batch: Record<string, any>[] = [];
    const batchSize = 100;
    let batchCount = 0;

    let totalMigrated = 0;

    for await (const userDoc of cursor) {
      batch.push(userDoc as Record<string, any>)

      if (batch.length >= batchSize) {
        for (const doc of batch) {
          const count = await migrateUserPlayback(doc, watchHistoryCollection)
          totalMigrated += count
        }

        batchCount++
        log.debug({ batchCount, totalMigrated }, 'Migration batch processed')
        batch = []
      }
    }

    // Process remaining batch
    if (batch.length > 0) {
      for (const doc of batch) {
        const count = await migrateUserPlayback(doc, watchHistoryCollection)
        totalMigrated += count
      }
    }

    log.info(
      { playbackStatusCount, totalMigrated, watchHistoryCount: await watchHistoryCollection.countDocuments() },
      'PlaybackStatus to WatchHistory migration complete'
    )
  } catch (error) {
    // Log error but don't crash app - graceful degradation
    log.error({ error }, 'PlaybackStatus migration failed, will retry on next startup')
  }
}
