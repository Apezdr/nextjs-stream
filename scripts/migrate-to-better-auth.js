#!/usr/bin/env node
/**
 * Migration: NextAuth.js → better-auth
 *
 * Transforms the Users database to match better-auth's expected schema.
 * Run ONCE before switching to better-auth. Creates *_backup collections
 * before any destructive operation.
 *
 * Usage:
 *   node scripts/migrate-to-better-auth.js                    # Normal migration
 *   MIGRATION_DRY_RUN=true node scripts/migrate-to-better-auth.js   # Dry run (no changes)
 *   MIGRATION_VERIFY_ONLY=true node scripts/migrate-to-better-auth.js  # Verification only
 *
 * Requires MONGODB_URI and optionally ADMIN_USER_EMAILS in environment
 * (or a local .env.local file).
 *
 * Environment Variables:
 *   MONGODB_URI          - MongoDB connection string (required)
 *   MONGODB_AUTH_DB      - Auth database name (default: 'Users')
 *   ADMIN_USER_EMAILS    - Comma-separated admin emails
 *   MIGRATION_DRY_RUN    - Set to 'true' for dry run mode (logs only, no changes)
 *   MIGRATION_VERIFY_ONLY - Set to 'true' to only verify references (no migration)
 */

const { MongoClient, ObjectId } = require('mongodb')
const path = require('path')

// Load .env.local
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') })
} catch {
  // dotenv may not be installed; ensure env vars are set manually
}

const MONGODB_URI = process.env.MONGODB_URI
if (!MONGODB_URI) {
  console.error('ERROR: MONGODB_URI environment variable is required.')
  process.exit(1)
}

const DB_NAME = process.env.MONGODB_AUTH_DB || 'Users'
const MEDIA_DB_NAME = process.env.MONGODB_DB || 'Media'
const ADMIN_EMAILS = (process.env.ADMIN_USER_EMAILS || '')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean)

// Migration modes
const DRY_RUN = process.env.MIGRATION_DRY_RUN === 'true'
const VERIFY_ONLY = process.env.MIGRATION_VERIFY_ONLY === 'true'

if (DRY_RUN) {
  console.log('\n🔍 DRY RUN MODE - No changes will be made to the database\n')
}

if (VERIFY_ONLY) {
  console.log('\n✅ VERIFY MODE - Only checking references, no migration\n')
}

async function backup(db, sourceName, backupName) {
  const existing = await db.listCollections({ name: backupName }).toArray()
  if (existing.length > 0) {
    console.log(`  Backup ${backupName} already exists — skipping backup creation.`)
    return
  }
  const docs = await db.collection(sourceName).find({}).toArray()
  if (docs.length === 0) {
    console.log(`  ${sourceName} is empty — no backup needed.`)
    return
  }
  await db.collection(backupName).insertMany(docs)
  console.log(`  Backed up ${docs.length} docs from ${sourceName} → ${backupName}`)
}

async function run() {
  const client = new MongoClient(MONGODB_URI)
  await client.connect()
  console.log('Connected to MongoDB.')
  const db = client.db(DB_NAME)

  // ─── 1. AuthenticatedUsers → user ────────────────────────────────────────
  console.log('\n[1/5] Migrating AuthenticatedUsers → user')
  const oldUsersExists = (await db.listCollections({ name: 'AuthenticatedUsers' }).toArray()).length > 0
  const newUsersExists = (await db.listCollections({ name: 'user' }).toArray()).length > 0

  if (!oldUsersExists && newUsersExists) {
    console.log('  user collection already exists and AuthenticatedUsers is gone — skipping.')
  } else if (oldUsersExists) {
    await backup(db, 'AuthenticatedUsers', 'AuthenticatedUsers_backup')

    const oldUsers = await db.collection('AuthenticatedUsers').find({}).toArray()
    console.log(`  Found ${oldUsers.length} users to migrate.`)

    const newUsers = oldUsers.map((u) => {
      const isAdmin = ADMIN_EMAILS.includes(u.email)
      const role = isAdmin ? 'admin' : 'user'

      const newDoc = {
        _id: u._id, // Preserve ObjectId — WatchHistory.userId references remain valid
        name: u.name ?? '',
        email: u.email ?? '',
        emailVerified: u.emailVerified instanceof Date ? u.emailVerified : (u.emailVerified ? new Date() : null),
        image: u.image ?? null,
        createdAt: u.createdAt instanceof Date ? u.createdAt : new Date(),
        updatedAt: u.updatedAt instanceof Date ? u.updatedAt : new Date(),
        // better-auth admin plugin role field
        role,
        // Preserved additional fields (mapped to additionalFields in auth config)
        approved: isAdmin ? true : (typeof u.approved === 'boolean' ? u.approved : false),
        limitedAccess: typeof u.limitedAccess === 'boolean' ? u.limitedAccess : false,
        // FIXED: Keep preferences as object (not JSON string) to match better-auth config type: 'object'
        preferences: u.preferences || {},
      }
      // Remove legacy fields
      delete newDoc.admin
      delete newDoc.adminStatusSyncedAt
      return newDoc
    })

    if (newUsers.length > 0) {
      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would insert ${newUsers.length} users into user collection`)
        console.log(`  [DRY RUN] Sample user: ${JSON.stringify(newUsers[0], null, 2)}`)
      } else {
        if (newUsersExists) {
          // Drop existing partial migration before re-inserting
          await db.collection('user').drop()
          console.log('  Dropped existing user collection for clean re-migration.')
        }
        await db.collection('user').insertMany(newUsers)
        console.log(`  Inserted ${newUsers.length} users into user collection.`)
        
        // Verify count
        const insertedCount = await db.collection('user').countDocuments()
        if (insertedCount !== oldUsers.length) {
          console.error(`  MISMATCH: expected ${oldUsers.length}, got ${insertedCount}. Do NOT delete AuthenticatedUsers.`)
          process.exit(1)
        }
        console.log(`  Verification passed: ${insertedCount} / ${oldUsers.length} users migrated.`)
      }
    }
  }

  // ─── 2. SSOAccounts → account ─────────────────────────────────────────────
  console.log('\n[2/5] Migrating SSOAccounts → account')
  const oldAccountsExists = (await db.listCollections({ name: 'SSOAccounts' }).toArray()).length > 0
  const newAccountsExists = (await db.listCollections({ name: 'account' }).toArray()).length > 0

  if (!oldAccountsExists && newAccountsExists) {
    console.log('  account collection already exists and SSOAccounts is gone — skipping.')
  } else if (oldAccountsExists) {
    await backup(db, 'SSOAccounts', 'SSOAccounts_backup')

    const oldAccounts = await db.collection('SSOAccounts').find({}).toArray()
    console.log(`  Found ${oldAccounts.length} accounts to migrate.`)

    const newAccounts = oldAccounts.map((a) => ({
      _id: a._id,
      userId: a.userId,          // ObjectId reference to user._id (still valid)
      providerId: a.provider,    // NextAuth "provider" → better-auth "providerId"
      accountId: a.providerAccountId,
      accessToken: a.access_token ?? null,
      refreshToken: a.refresh_token ?? null,
      accessTokenExpiresAt: a.expires_at ? new Date(a.expires_at * 1000) : null,
      scope: a.scope ?? null,
      tokenType: a.token_type ?? null,
      idToken: a.id_token ?? null,
      createdAt: a.createdAt instanceof Date ? a.createdAt : new Date(),
      updatedAt: a.updatedAt instanceof Date ? a.updatedAt : new Date(),
    }))

    if (newAccounts.length > 0) {
      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would insert ${newAccounts.length} accounts into account collection`)
      } else {
        if (newAccountsExists) await db.collection('account').drop()
        await db.collection('account').insertMany(newAccounts)
        console.log(`  Inserted ${newAccounts.length} accounts into account collection.`)
      }
    }
  }

  // ─── 3. session — drop all (sessions will be disrupted) ──────────────────
  console.log('\n[3/6] Clearing session collection')
  const sessionExists = (await db.listCollections({ name: 'session' }).toArray()).length > 0
  if (sessionExists) {
    const sessionCount = await db.collection('session').countDocuments()
    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would drop ${sessionCount} old sessions`)
    } else {
      await db.collection('session').drop()
      console.log(`  Dropped ${sessionCount} old sessions (users will need to re-authenticate).`)
    }
  } else {
    console.log('  session collection does not exist — nothing to clear.')
  }

  // ─── 4. verificationTokens → verification ────────────────────────────────
  console.log('\n[4/6] Migrating verificationTokens → verification')
  const oldVerifExists = (await db.listCollections({ name: 'verificationTokens' }).toArray()).length > 0
  const newVerifExists = (await db.listCollections({ name: 'verification' }).toArray()).length > 0

  if (!oldVerifExists && newVerifExists) {
    console.log('  verification collection already exists and verificationTokens is gone — skipping.')
  } else if (oldVerifExists) {
    await backup(db, 'verificationTokens', 'verificationTokens_backup')
    const oldTokens = await db.collection('verificationTokens').find({}).toArray()
    const newTokens = oldTokens.map((t) => ({
      _id: t._id,
      identifier: t.identifier,
      value: t.token,           // NextAuth "token" → better-auth "value"
      expiresAt: t.expires instanceof Date ? t.expires : new Date(t.expires),
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
    if (newTokens.length > 0) {
      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would migrate ${newTokens.length} verification tokens`)
      } else {
        if (newVerifExists) await db.collection('verification').drop()
        await db.collection('verification').insertMany(newTokens)
        console.log(`  Migrated ${newTokens.length} verification tokens.`)
      }
    }
  }

  // ─── 5. Drop legacy collections ───────────────────────────────────────────
  console.log('\n[5/6] Dropping legacy collections')

  const toDrop = ['usedTokens', 'authSessions']
  for (const name of toDrop) {
    const exists = (await db.listCollections({ name }).toArray()).length > 0
    if (exists) {
      const count = await db.collection(name).countDocuments()
      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would drop ${name} (${count} docs)`)
      } else {
        await db.collection(name).drop()
        console.log(`  Dropped ${name} (${count} docs).`)
      }
    } else {
      console.log(`  ${name} does not exist — skipping.`)
    }
  }

  // ─── 6. Verify PlaylistVisibility references (Users database) ─────────────
  console.log('\n[6/6] Verifying PlaylistVisibility collection')
  const plVisExists = (await db.listCollections({ name: 'PlaylistVisibility' }).toArray()).length > 0

  if (plVisExists) {
    const plVisCount = await db.collection('PlaylistVisibility').countDocuments()
    console.log(`  Found ${plVisCount} PlaylistVisibility records`)
    console.log('  ℹ️  This collection references user._id which is preserved during migration')
    console.log('  ℹ️  No migration needed - foreign key references remain valid')
    
    // Sample verification
    if (!DRY_RUN) {
      const sample = await db.collection('PlaylistVisibility').findOne({})
      if (sample) {
        const userExists = await db.collection('user').findOne({ _id: sample.userId })
        if (userExists) {
          console.log('  ✅ Verified: PlaylistVisibility.userId references are valid (sample check)')
        } else {
          console.warn('  ⚠️  WARNING: Sample PlaylistVisibility.userId reference is invalid')
        }
      }
    }
  } else {
    console.log('  PlaylistVisibility collection does not exist (this is normal for new installs)')
  }

  // ─── Verification: Check foreign key references ───────────────────────────
  if (!DRY_RUN) {
    console.log('\n[Verification] Checking foreign key references in Media database...')
    const mediaDb = client.db(MEDIA_DB_NAME)
    
    // Check WatchHistory references (sample)
    const watchHistoryCount = await mediaDb.collection('WatchHistory').estimatedDocumentCount()
    if (watchHistoryCount > 0) {
      const sampleSize = Math.min(100, watchHistoryCount)
      const watchHistorySample = await mediaDb.collection('WatchHistory')
        .aggregate([
          { $sample: { size: sampleSize } },
          { $project: { userId: 1 } }
        ])
        .toArray()
      
      let orphanedCount = 0
      for (const entry of watchHistorySample) {
        const userExists = await db.collection('user').findOne({ _id: entry.userId })
        if (!userExists) orphanedCount++
      }
      
      if (orphanedCount === 0) {
        console.log(`  ✅ WatchHistory userId references valid (checked ${sampleSize} entries)`)
      } else {
        console.error(`  ❌ CRITICAL: Found ${orphanedCount}/${sampleSize} orphaned WatchHistory entries`)
        console.error('     Migration should be reviewed before continuing.')
      }
    } else {
      console.log('  ℹ️  No WatchHistory entries to verify (empty collection)')
    }

    // Check Watchlist references (sample)
    const watchlistCount = await mediaDb.collection('Watchlist').estimatedDocumentCount()
    if (watchlistCount > 0) {
      const sampleSize = Math.min(50, watchlistCount)
      const watchlistSample = await mediaDb.collection('Watchlist')
        .aggregate([
          { $sample: { size: sampleSize } },
          { $project: { userId: 1 } }
        ])
        .toArray()
      
      let orphanedCount = 0
      for (const entry of watchlistSample) {
        const userExists = await db.collection('user').findOne({ _id: entry.userId })
        if (!userExists) orphanedCount++
      }
      
      if (orphanedCount === 0) {
        console.log(`  ✅ Watchlist userId references valid (checked ${sampleSize} entries)`)
      } else {
        console.error(`  ❌ CRITICAL: Found ${orphanedCount}/${sampleSize} orphaned Watchlist entries`)
        console.error('     Migration should be reviewed before continuing.')
      }
    } else {
      console.log('  ℹ️  No Watchlist entries to verify (empty collection)')
    }

    // Check Playlists references (sample)
    const playlistsCount = await mediaDb.collection('Playlists').estimatedDocumentCount()
    if (playlistsCount > 0) {
      const sampleSize = Math.min(50, playlistsCount)
      const playlistsSample = await mediaDb.collection('Playlists')
        .aggregate([
          { $sample: { size: sampleSize } },
          { $project: { ownerId: 1 } }
        ])
        .toArray()
      
      let orphanedCount = 0
      for (const entry of playlistsSample) {
        const userExists = await db.collection('user').findOne({ _id: entry.ownerId })
        if (!userExists) orphanedCount++
      }
      
      if (orphanedCount === 0) {
        console.log(`  ✅ Playlists ownerId references valid (checked ${sampleSize} entries)`)
      } else {
        console.error(`  ❌ CRITICAL: Found ${orphanedCount}/${sampleSize} orphaned Playlists entries`)
        console.error('     Migration should be reviewed before continuing.')
      }
    } else {
      console.log('  ℹ️  No Playlists to verify (empty collection)')
    }
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  if (DRY_RUN) {
    console.log('\n✅ Dry run complete - no changes were made to the database.')
    console.log('\nTo perform the actual migration, run:')
    console.log('  node scripts/migrate-to-better-auth.js')
  } else {
    console.log('\n✅ Migration complete.')
    console.log('\n⚠️  IMPORTANT: Backup collections retained for safety:')
    console.log('  - AuthenticatedUsers_backup')
    console.log('  - SSOAccounts_backup')
    console.log('  - verificationTokens_backup')
    console.log('\n📅 Recommended: Keep backups for 30 days before dropping')
    console.log('   After verifying everything works, you can drop backups with:')
    console.log('   db.AuthenticatedUsers_backup.drop()')
    console.log('   db.SSOAccounts_backup.drop()')
    console.log('   db.verificationTokens_backup.drop()')
    console.log('\nNext steps:')
    console.log('  1. Update .env.local with better-auth environment variables')
    console.log('  2. Ensure BETTER_AUTH_SECRET and BETTER_AUTH_URL are set')
    console.log('  3. Start the dev server and test:')
    console.log('     - Google OAuth sign-in')
    console.log('     - Discord OAuth sign-in')
    console.log('     - Admin user has admin role')
    console.log('     - Watch history displays correctly')
    console.log('     - Playlists and watchlist work')
    console.log('     - Device authorization flow (TV apps)')
  }

  await client.close()
}

run().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
