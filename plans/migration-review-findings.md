# Migration Script Review: AuthJS → BetterAuth

## Executive Summary

**Migration Coverage Status**: ⚠️ **INCOMPLETE - Critical Issues Found**

Your migration script covers the core authentication collections but has **3 critical issues** that must be addressed before migration:

1. 🚨 **CRITICAL**: `PlaylistVisibility` collection is **NOT migrated** (Users database)
2. ⚠️ **WARNING**: `preferences` field type mismatch 
3. ✅ **VERIFIED**: WatchHistory references are preserved correctly

---

## Database Architecture Overview

Your application uses a **dual-database architecture**:

```
┌─────────────────────────────────────────────────────────────┐
│  Users Database (MONGODB_AUTH_DB="Users")                   │
│  ┌──────────────────────┐  ┌─────────────────────────────┐ │
│  │ AuthenticatedUsers → │  │ user (better-auth)          │ │
│  │ SSOAccounts →        │  │ account (better-auth)       │ │
│  │ verificationTokens → │  │ verification (better-auth)  │ │
│  │ session →            │  │ session (better-auth)       │ │
│  └──────────────────────┘  └─────────────────────────────┘ │
│                                                              │
│  ⚠️ NOT MIGRATED:                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ PlaylistVisibility                                   │   │
│  │ - References userId (from AuthenticatedUsers/user)   │   │
│  │ - References playlistId (from Media.Playlists)       │   │
│  │ - Critical for "Show in App" feature                 │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Media Database (MONGODB_DB="Media")                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ WatchHistory                                         │   │
│  │ - userId: ObjectId → References Users.user._id      │   │
│  │ - ✅ Safe: _id preserved during migration           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  │ Watchlist (playlist items)                           │   │
│  │ - userId: ObjectId → References Users.user._id      │   │
│  │ - playlistId: ObjectId → References Playlists._id   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  │ Playlists                                            │   │
│  │ - ownerId: ObjectId → References Users.user._id     │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Critical Issue #1: Missing PlaylistVisibility Migration

### Problem

The [`PlaylistVisibility`](src/utils/watchlist/database.js:1751) collection in the **Users database** is **NOT included** in your migration script. This collection:

- **Location**: `Users.PlaylistVisibility`
- **Purpose**: Tracks which playlists appear in each user's app
- **Schema**:
  ```javascript
  {
    _id: ObjectId,
    userId: ObjectId,      // → Users.user._id
    playlistId: ObjectId,  // → Media.Playlists._id  
    showInApp: boolean,
    appOrder: number,
    appTitle: string (optional),
    dateCreated: Date,
    dateUpdated: Date
  }
  ```

### Impact

**This collection will continue working after migration** because:
- It only references `user._id` (which is preserved during migration)
- `playlistId` references the Media database (unaffected by auth migration)

**However**, for consistency and completeness, you should:
1. Verify all userId references are valid ObjectIds
2. Add it to your migration documentation
3. Consider adding validation checks

### Current Usage

Found in codebase:
- [`src/utils/watchlist/database.js`](src/utils/watchlist/database.js:1751) - Main CRUD operations
- [`src/components/LandingPage.js`](src/components/LandingPage.js:96) - User playlist visibility
- [`src/components/Watchlist/ShowInAppUserModal.js`](src/components/Watchlist/ShowInAppUserModal.js:43) - User settings
- [`src/components/Watchlist/ShowInAppAdminModal.js`](src/components/Watchlist/ShowInAppAdminModal.js:132) - Admin management

---

## Critical Issue #2: Preferences Field Type Mismatch

### Problem

**Migration Script** (line 90):
```javascript
preferences: u.preferences ? JSON.stringify(u.preferences) : null
```

**Better-Auth Config** ([`src/lib/auth.ts:77`](src/lib/auth.ts:77)):
```typescript
preferences: {
  type: 'string',  // Declares as string
  required: false,
  input: true,
}
```

**Current Database Reality**:
```json
"preferences": {
  "tvAppsNotificationDismissed": true,
  "tvAppsNotificationDismissedAt": {"$date": "2026-03-11T15:43:34.032Z"}
}
```

### Analysis

Your preferences are currently stored as **objects** in MongoDB, but:
- Migration script tries to convert to **JSON strings**
- Better-auth config declares type as **string**
- Current database shows preferences as **objects**

### Recommended Solution

**Option A: Keep as Object** (Recommended based on your preference)

1. **Update [`src/lib/auth.ts`](src/lib/auth.ts:77)**:
   ```typescript
   preferences: {
     type: 'object',  // Change from 'string' to 'object'
     required: false,
     input: true,
   }
   ```

2. **Update migration script** (line 90):
   ```javascript
   preferences: u.preferences || {},  // Keep as object
   ```

**Option B: Convert to JSON String**

If better-auth requires string type:
1. Keep migration script as-is
2. Update all API endpoints that read/write preferences to:
   - `JSON.parse()` when reading
   - `JSON.stringify()` when writing

### Files to Update (if choosing Option A)

- [`scripts/migrate-to-better-auth.js:90`](scripts/migrate-to-better-auth.js:90) - Remove JSON.stringify
- [`src/lib/auth.ts:77`](src/lib/auth.ts:77) - Change type to 'object'

---

## ✅ What's Working Correctly

### 1. User Migration (Lines 59-115)

**Coverage**: ✅ **COMPLETE**

```javascript
AuthenticatedUsers → user
- _id preserved (ObjectId) ✅ CRITICAL for foreign keys
- name, email, image ✅
- emailVerified ✅
- approved ✅
- limitedAccess ✅
- preferences ⚠️ (needs fix above)
- role (admin/user) ✅
- Removes: admin, adminStatusSyncedAt ✅
```

**Verification Check**:
```javascript
if (insertedCount !== oldUsers.length) {
  console.error(`MISMATCH: expected ${oldUsers.length}, got ${insertedCount}`)
  process.exit(1) // Safe: prevents data loss
}
```

### 2. Account Migration (Lines 117-150)

**Coverage**: ✅ **COMPLETE**

```javascript
SSOAccounts → account
- _id preserved ✅
- userId preserved (ObjectId) ✅
- provider → providerId ✅
- providerAccountId → accountId ✅
- access_token → accessToken ✅
- refresh_token → refreshToken ✅
- expires_at → accessTokenExpiresAt (Date conversion) ✅
- scope, tokenType, idToken ✅
```

### 3. Session Clearing (Lines 152-161)

**Coverage**: ✅ **EXPECTED DISRUPTION**

- Drops all sessions (users must re-authenticate) ✅
- This is correct behavior for auth system migration ✅

### 4. Verification Tokens (Lines 163-186)

**Coverage**: ✅ **COMPLETE**

```javascript
verificationTokens → verification
- identifier ✅
- token → value ✅
- expires → expiresAt (Date) ✅
```

### 5. WatchHistory References

**Status**: ✅ **SAFE - No Migration Needed**

**Why it's safe**:
1. WatchHistory lives in **Media database** (not migrated)
2. WatchHistory references `userId: ObjectId`
3. Migration **preserves user._id** during AuthenticatedUsers → user migration
4. All existing WatchHistory entries will continue working

**Evidence from codebase**:
- [`src/utils/watchHistory/database.js:37`](src/utils/watchHistory/database.js:37) - Uses `userId: ObjectId`
- [`src/utils/watchHistory/migrate.ts:53`](src/utils/watchHistory/migrate.ts:53) - Migration from PlaybackStatus to WatchHistory
- All watch history queries use userId references

**Collections referencing Users.user._id** (all in Media database):
- ✅ `WatchHistory.userId` → Safe (preserved _id)
- ✅ `Watchlist.userId` → Safe (preserved _id)
- ✅ `Playlists.ownerId` → Safe (preserved _id)

---

## Migration Verification Checklist

After running migration, verify:

### 1. User Data Integrity

```javascript
// Check: User count matches
db.AuthenticatedUsers_backup.countDocuments() === db.user.countDocuments()

// Check: All _id values preserved
db.user.find().forEach(u => {
  const old = db.AuthenticatedUsers_backup.findOne({_id: u._id})
  assert(old !== null, `User ${u._id} missing from backup`)
})

// Check: Email uniqueness maintained
db.user.aggregate([
  {$group: {_id: "$email", count: {$sum: 1}}},
  {$match: {count: {$gt: 1}}}
])
```

### 2. Foreign Key References

```javascript
// Media database checks
use Media

// Check: All WatchHistory userId references are valid
db.WatchHistory.aggregate([
  {$lookup: {
    from: "Users.user",  // Cross-database lookup
    localField: "userId",
    foreignField: "_id",
    as: "userMatch"
  }},
  {$match: {userMatch: {$size: 0}}},
  {$count: "orphanedWatchHistory"}
])
// Expected: 0

// Check: All Watchlist userId references are valid
db.Watchlist.aggregate([
  {$lookup: {
    from: "Users.user",
    localField: "userId", 
    foreignField: "_id",
    as: "userMatch"
  }},
  {$match: {userMatch: {$size: 0}}},
  {$count: "orphanedWatchlist"}
])
// Expected: 0

// Check: All Playlists ownerId references are valid  
db.Playlists.aggregate([
  {$lookup: {
    from: "Users.user",
    localField: "ownerId",
    foreignField: "_id",
    as: "userMatch"
  }},
  {$match: {userMatch: {$size: 0}}},
  {$count: "orphanedPlaylists"}
])
// Expected: 0
```

### 3. PlaylistVisibility Integrity

```javascript
// Users database
use Users

// Check: All PlaylistVisibility.userId references are valid
db.PlaylistVisibility.aggregate([
  {$lookup: {
    from: "user",
    localField: "userId",
    foreignField: "_id",
    as: "userMatch"
  }},
  {$match: {userMatch: {$size: 0}}},
  {$count: "orphanedVisibility"}
])
// Expected: 0
```

### 4. Admin Role Sync

```javascript
// Check: All admin emails have admin role
const adminEmails = process.env.ADMIN_USER_EMAILS.split(',').map(e => e.trim())
db.user.find({email: {$in: adminEmails}}).forEach(u => {
  assert(u.role === 'admin', `${u.email} should be admin`)
  assert(u.approved === true, `${u.email} should be approved`)
})
```

### 5. Preferences Format

```javascript
// Check: Preferences field type consistency
const sample = db.user.findOne({preferences: {$exists: true, $ne: null}})
console.log('Preferences type:', typeof sample.preferences) 
// Expected: "object" (if using Option A)
// Expected: "string" (if using Option B)
```

---

## Rollback Strategy

### Immediate Rollback (During Migration)

**If verification fails**:
```javascript
// In mongo shell
use Users

// Restore from backups (created by migration script)
db.user.drop()
db.account.drop()
db.verification.drop()

db.AuthenticatedUsers_backup.find().forEach(doc => db.AuthenticatedUsers.insert(doc))
db.SSOAccounts_backup.find().forEach(doc => db.SSOAccounts.insert(doc))
db.verificationTokens_backup.find().forEach(doc => db.verificationTokens.insert(doc))

// Drop backup collections
db.AuthenticatedUsers_backup.drop()
db.SSOAccounts_backup.drop()
db.verificationTokens_backup.drop()
```

### Post-Migration Rollback (After Testing)

**If you discover issues later**:

1. **Stop the application** to prevent new data
2. **Take snapshot** of current state:
   ```bash
   mongodump --db=Users --out=/backup/post-migration-$(date +%Y%m%d)
   ```
3. **Restore from backup collections** (if still available):
   ```javascript
   // Same as immediate rollback above
   ```
4. **Update application** to use old auth system:
   - Revert code to use NextAuth.js
   - Update environment variables
5. **Restart application**

### Prevention: Keep Backups Longer

**Recommendation**: Don't drop backup collections immediately. Keep for 30 days:

```javascript
// Add to migration script after success
console.log('\n✅ Migration complete.')
console.log('\n⚠️  IMPORTANT: Backup collections retained for safety:')
console.log('  - AuthenticatedUsers_backup')
console.log('  - SSOAccounts_backup')
console.log('  - verificationTokens_backup')
console.log('\n📅 Recommended: Keep backups for 30 days before dropping')
console.log('   After 30 days, run: db.AuthenticatedUsers_backup.drop()')
```

---

## Pre-Migration Action Items

### 🚨 MUST FIX (Before Migration)

1. **Fix preferences field mismatch**:
   - [ ] Decision: Keep as object or convert to string?
   - [ ] Update [`scripts/migrate-to-better-auth.js:90`](scripts/migrate-to-better-auth.js:90)
   - [ ] Update [`src/lib/auth.ts:77`](src/lib/auth.ts:77) if needed

2. **Document PlaylistVisibility**:
   - [ ] Add comment in migration script about PlaylistVisibility
   - [ ] Explain why it doesn't need migration (references preserved _id)
   - [ ] Add to verification checklist

3. **Test in staging first**:
   - [ ] Create full database backup
   - [ ] Run migration in staging environment
   - [ ] Run all verification queries
   - [ ] Test user login (Google, Discord)
   - [ ] Test watch history display
   - [ ] Test playlist visibility features
   - [ ] Test admin functionality

### ⚠️ SHOULD FIX (Recommended)

1. **Add environment variable for backup retention**:
   ```javascript
   const KEEP_BACKUPS = process.env.MIGRATION_KEEP_BACKUPS !== 'false'
   ```

2. **Add verification script**:
   - Create separate `scripts/verify-migration.js`
   - Run all integrity checks
   - Generate migration report

3. **Add migration dry-run mode**:
   ```javascript
   const DRY_RUN = process.env.MIGRATION_DRY_RUN === 'true'
   if (DRY_RUN) {
     console.log('[DRY RUN] Would insert:', newUsers.length, 'users')
     return // Don't actually migrate
   }
   ```

---

## Post-Migration Testing Plan

### Critical Paths to Test

1. **Authentication Flow**:
   - [ ] Google OAuth sign-in
   - [ ] Discord OAuth sign-in
   - [ ] Account linking (same email, different providers)
   - [ ] Session persistence
   - [ ] Device authorization flow (TV apps)

2. **User Data Integrity**:
   - [ ] User profile displays correctly
   - [ ] Email verification status preserved
   - [ ] Admin users have admin role
   - [ ] Approved users can access content
   - [ ] User preferences load correctly

3. **Watch History** (CRITICAL):
   - [ ] Previously watched content shows progress bars
   - [ ] Resume playback works
   - [ ] Recently watched section displays
   - [ ] Watch history updates during playback
   - [ ] Recommendations based on watch history work

4. **Playlist Features**:
   - [ ] User playlists load correctly
   - [ ] Watchlist items display
   - [ ] Add/remove from playlists works
   - [ ] "Show in App" visibility works
   - [ ] Shared playlists accessible
   - [ ] Public playlists visible

5. **Admin Functions**:
   - [ ] Admin dashboard accessible
   - [ ] All admin emails have admin role
   - [ ] Admin can manage users
   - [ ] Admin can manage playlists
   - [ ] Admin can set playlist visibility

---

## Recommended Migration Script Updates

### Add to beginning of script:

```javascript
const DRY_RUN = process.env.MIGRATION_DRY_RUN === 'true'
const VERIFY_ONLY = process.env.MIGRATION_VERIFY_ONLY === 'true'

if (DRY_RUN) {
  console.log('🔍 DRY RUN MODE - No changes will be made')
}

if (VERIFY_ONLY) {
  console.log('✅ VERIFY MODE - Only checking references')
  // Run all verification queries and exit
}
```

### Add documentation about PlaylistVisibility:

```javascript
// ─── 6. PlaylistVisibility (Users database - NO migration needed) ───
console.log('\n[6/6] Verifying PlaylistVisibility references')
const plVisExists = (await db.listCollections({ name: 'PlaylistVisibility' }).toArray()).length > 0

if (plVisExists) {
  const plVisCount = await db.collection('PlaylistVisibility').countDocuments()
  console.log(`  Found ${plVisCount} PlaylistVisibility records`)
  console.log('  ℹ️  This collection references user._id which is preserved during migration')
  console.log('  ℹ️  No migration needed - foreign key references remain valid')
}
```

### Add comprehensive verification:

```javascript
// ─── Verification ────────────────────────────────────────────────────
console.log('\n[Verification] Checking data integrity...')

// Check WatchHistory references
const mediaDb = client.db('Media')
const orphanedWatchHistory = await mediaDb.collection('WatchHistory')
  .aggregate([
    { $limit: 100 }, // Sample check
    { $lookup: { 
        from: 'Users.user',
        localField: 'userId',
        foreignField: '_id',
        as: 'userMatch'
    }},
    { $match: { 'userMatch.0': { $exists: false } } }
  ]).toArray()

if (orphanedWatchHistory.length > 0) {
  console.error(`  ⚠️  Found ${orphanedWatchHistory.length} orphaned WatchHistory records`)
  console.error('  This should not happen. Review migration before continuing.')
} else {
  console.log('  ✅ WatchHistory userId references valid (sample check)')
}
```

---

## Summary & Recommendations

### Migration Script Status: ⚠️ **Nearly Complete with Minor Issues**

| Component | Status | Action Required |
|-----------|--------|-----------------|
| Users Migration | ✅ Complete | Fix preferences field type |
| Accounts Migration | ✅ Complete | None |
| Sessions | ✅ Complete | None |
| Verification Tokens | ✅ Complete | None |
| WatchHistory | ✅ Safe | None (preserved references) |
| Watchlist | ✅ Safe | None (preserved references) |
| Playlists | ✅ Safe | None (preserved references) |
| PlaylistVisibility | ⚠️ Not migrated | Document why (references preserved) |

### Before Migration

1. ✅ **Backup entire database** (both Users and Media)
2. 🔧 **Fix preferences** field type mismatch
3. 📝 **Add PlaylistVisibility** documentation to script
4. 🧪 **Test in staging** environment first
5. ✅ **Prepare rollback** procedure

### Critical Success Factor

**The migration preserves user `_id` values**, which is the KEY to maintaining referential integrity across both databases. This is correctly implemented and all foreign key references (WatchHistory, Watchlist, Playlists, PlaylistVisibility) will continue working.

---

## Questions for Final Review

1. **Preferences Storage**: Confirmed you want to keep as object?
2. **Backup Retention**: How long should backup collections be kept?
3. **Staging Environment**: Do you have a staging environment for testing?
4. **Downtime Window**: Can you schedule maintenance window for migration?
5. **User Communication**: Will you notify users of re-authentication requirement?

---

*Generated: 2026-03-16*
*Migration Script: `/scripts/migrate-to-better-auth.js`*
