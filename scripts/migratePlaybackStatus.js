#!/usr/bin/env node

/**
 * Migrate PlaybackStatus to WatchHistory
 * 
 * One-time migration script to convert from the old PlaybackStatus schema
 * (1 document per user with embedded array) to new WatchHistory schema
 * (1 document per user+video pair) for better concurrency and performance.
 * 
 * This script is idempotent - it can be safely re-run without duplicates
 * due to upsert with compound unique index on {userId, normalizedVideoId}.
 * 
 * Usage:
 *   node scripts/migratePlaybackStatus.js
 * 
 * The original PlaybackStatus collection is NOT deleted - it remains as a fallback.
 * After verification on staging, you can manually drop it.
 */

const { MongoClient, ObjectId } = require('mongodb')

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017'
const DB_NAME = 'Media'
const OLD_COLLECTION = 'PlaybackStatus'
const NEW_COLLECTION = 'WatchHistory'

// Track migration statistics
let stats = {
  usersProcessed: 0,
  entriesMigrated: 0,
  entriesSkipped: 0,
  errorCount: 0,
  startTime: null,
  endTime: null
}

/**
 * Generate normalized video ID from URL
 * (This is a temporary implementation - in production, import from flatDatabaseUtils)
 */
function generateNormalizedVideoId(videoId) {
  const crypto = require('crypto')
  return crypto.createHash('sha256').update(videoId).digest('hex').substring(0, 16)
}

/**
 * Connect to MongoDB
 */
async function connectToDb() {
  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 10 })
  await client.connect()
  return client
}

/**
 * Create indexes on WatchHistory collection
 */
async function createWatchHistoryIndexes(db) {
  const collection = db.collection(NEW_COLLECTION)

  const indexes = [
    { key: { userId: 1, normalizedVideoId: 1 }, unique: true, name: 'userId_normalizedId_unique' },
    { key: { userId: 1 }, name: 'userId_index' },
    { key: { normalizedVideoId: 1 }, name: 'normalizedVideoId_index' },
    { key: { userId: 1, lastUpdated: -1 }, name: 'userId_lastUpdated_index' }
  ]

  console.log('Creating indexes on WatchHistory collection...')

  for (const indexSpec of indexes) {
    try {
      await collection.createIndex(indexSpec.key, {
        name: indexSpec.name,
        unique: indexSpec.unique || false
      })
      console.log(`  ✓ ${indexSpec.name}`)
    } catch (error) {
      if (error.code === 85 || error.code === 86) {
        // Index already exists - this is fine
        console.log(`  ~ ${indexSpec.name} (already exists)`)
      } else {
        throw error
      }
    }
  }
}

/**
 * Migrate a single PlaybackStatus document to WatchHistory documents
 */
async function migrateUserPlaybackStatus(userDoc, newCollection) {
  const { userId, videosWatched } = userDoc

  if (!videosWatched || !Array.isArray(videosWatched)) {
    return 0 // No videos to migrate
  }

  let migratedCount = 0

  // Convert each videosWatched entry to a separate WatchHistory document
  for (const video of videosWatched) {
    try {
      // Ensure normalizedVideoId exists (for backcompat with old entries)
      const normalizedVideoId = video.normalizedVideoId || generateNormalizedVideoId(video.videoId)

      // Build the new document
      const watchHistoryDoc = {
        userId,
        videoId: video.videoId,
        normalizedVideoId,
        playbackTime: video.playbackTime || 0,
        lastUpdated: video.lastUpdated || new Date(),
        isValid: video.isValid || null,
        lastScanned: video.lastScanned || null,
        mediaType: video.mediaType || null,
        mediaId: video.mediaId || null,
        deviceInfo: video.deviceInfo || null
      }

      // Add TV-specific fields if present
      if (video.mediaType === 'tv') {
        if (video.showId) watchHistoryDoc.showId = video.showId
        if (video.seasonNumber) watchHistoryDoc.seasonNumber = video.seasonNumber
        if (video.episodeNumber) watchHistoryDoc.episodeNumber = video.episodeNumber
      }

      // Upsert: if document exists, update it; if not, insert it
      // The unique compound index ensures no duplicates
      await newCollection.updateOne(
        { userId, normalizedVideoId },
        { $set: watchHistoryDoc },
        { upsert: true }
      )

      migratedCount++
    } catch (error) {
      console.error(`    Error migrating video ${video.videoId}:`, error.message)
      stats.errorCount++
    }
  }

  return migratedCount
}

/**
 * Main migration function
 */
async function migrate() {
  let client = null

  try {
    console.log('\n🚀 Starting PlaybackStatus → WatchHistory Migration\n')
    stats.startTime = Date.now()

    // Connect to MongoDB
    client = await connectToDb()
    const db = client.db(DB_NAME)

    console.log(`Connected to MongoDB: ${DB_NAME}`)

    // Get collections
    const oldCollection = db.collection(OLD_COLLECTION)
    const newCollection = db.collection(NEW_COLLECTION)

    // Create indexes on new collection first
    await createWatchHistoryIndexes(db)

    // Count total documents to migrate
    const totalUsers = await oldCollection.countDocuments()
    console.log(`\n📊 Found ${totalUsers} PlaybackStatus documents to process\n`)

    if (totalUsers === 0) {
      console.log('No documents to migrate. Exiting.')
      return
    }

    // Process each user's PlaybackStatus document
    let processedCount = 0
    const batchSize = 100
    let batch = []

    const cursor = oldCollection.find({})

    for await (const userDoc of cursor) {
      batch.push(userDoc)

      if (batch.length >= batchSize) {
        await processBatch(batch, newCollection)
        processedCount += batch.length
        console.log(`  Processed ${processedCount}/${totalUsers} users...`)
        batch = []
      }
    }

    // Process remaining batch
    if (batch.length > 0) {
      await processBatch(batch, newCollection)
      processedCount += batch.length
    }

    stats.endTime = Date.now()

    // Print summary
    printSummary()
  } catch (error) {
    console.error('\n❌ Migration failed:', error)
    process.exit(1)
  } finally {
    if (client) {
      await client.close()
    }
  }
}

/**
 * Process a batch of user documents
 */
async function processBatch(batch, newCollection) {
  for (const userDoc of batch) {
    try {
      stats.usersProcessed++
      const migratedCount = await migrateUserPlaybackStatus(userDoc, newCollection)
      stats.entriesMigrated += migratedCount
    } catch (error) {
      console.error(`Error processing user ${userDoc.userId}:`, error.message)
      stats.errorCount++
    }
  }
}

/**
 * Print migration summary
 */
function printSummary() {
  const duration = (stats.endTime - stats.startTime) / 1000
  const entriesPerSecond = Math.round(stats.entriesMigrated / duration)

  console.log('\n✅ Migration Complete\n')
  console.log(`  Users processed:        ${stats.usersProcessed}`)
  console.log(`  Entries migrated:       ${stats.entriesMigrated}`)
  console.log(`  Migration speed:        ${entriesPerSecond} entries/sec`)
  console.log(`  Duration:               ${duration.toFixed(2)}s`)

  if (stats.errorCount > 0) {
    console.log(`  Errors:                 ${stats.errorCount}`)
  }

  console.log('\n📝 Next Steps:\n')
  console.log('  1. Verify data in WatchHistory collection on staging')
  console.log('  2. Compare counts: db.PlaybackStatus.countDocuments() vs WatchHistory entries')
  console.log('  3. Deploy code using new watchHistory module')
  console.log('  4. Monitor in production for 24-48 hours')
  console.log('  5. Once confident, delete old PlaybackStatus collection:')
  console.log('     db.PlaybackStatus.drop()\n')
}

// Run migration
migrate().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
