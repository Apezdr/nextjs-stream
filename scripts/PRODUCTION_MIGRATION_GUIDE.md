# Production Migration Guide: Ubuntu Server

## Prerequisites Check

### What Needs to Exist BEFORE Migration
✅ **Must exist:**
- MongoDB server running and accessible
- `Users` database (or whatever you set in `MONGODB_AUTH_DB`)
- `Media` database (or whatever you set in `MONGODB_DB`)
- These collections in Users database:
  - `AuthenticatedUsers` (source data)
  - `SSOAccounts` (source data)
  - Optionally: `session`, `verificationTokens`, `authSessions`, `usedTokens`

### What Gets Created AUTOMATICALLY by Migration
✅ **Auto-created:**
- `user` collection (in Users database)
- `account` collection (in Users database)
- `verification` collection (if verificationTokens exists)
- `*_backup` collections (e.g., `AuthenticatedUsers_backup`)

### What Does NOT Need Migration
✅ **Already in correct database:**
- `WatchHistory` (in Media database)
- `Watchlist` (in Media database)
- `Playlists` (in Media database)
- `PlaylistVisibility` (in Users database)

---

## Ubuntu Production Deployment

### Step 1: Install Dependencies on Ubuntu

```bash
# Install Node.js if not already installed (requires Node 18+)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version  # Should be v18 or higher
npm --version
```

### Step 2: Upload Migration Script

```bash
# Create directory
sudo mkdir -p /var/www/migration
cd /var/www/migration

# Upload these files to /var/www/migration/:
# - migrate-to-better-auth.js
# - package.json (see below)

# Or if using git, clone and extract just the script:
# git clone <your-repo>
# cp <your-repo>/scripts/migrate-to-better-auth.js .
```

### Step 3: Create package.json

```bash
cat > package.json << 'EOF'
{
  "name": "auth-migration",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "mongodb": "^6.0.0",
    "dotenv": "^16.0.0"
  }
}
EOF
```

### Step 4: Install Dependencies

```bash
npm install
```

### Step 5: Set Environment Variables

**Option A: Using .env file (recommended)**

```bash
cat > .env << 'EOF'
MONGODB_URI=mongodb://username:password@your-server:27017/
MONGODB_AUTH_DB=Users
MONGODB_DB=Media
ADMIN_USER_EMAILS=admin1@example.com,admin2@example.com
EOF

# Secure the .env file
chmod 600 .env
```

**Option B: Using environment variables directly**

```bash
export MONGODB_URI="mongodb://username:password@your-server:27017/"
export MONGODB_AUTH_DB="Users"
export MONGODB_DB="Media"
export ADMIN_USER_EMAILS="admin1@example.com,admin2@example.com"
```

### Step 6: Backup Production Database

**CRITICAL: Always backup before migration!**

```bash
# Backup entire database
mongodump --uri="mongodb://username:password@your-server:27017/" \
  --out=/var/backups/mongodb/pre-migration-$(date +%Y%m%d-%H%M%S)

# Or backup specific databases
mongodump --uri="mongodb://username:password@your-server:27017/" \
  --db=Users \
  --out=/var/backups/mongodb/users-backup-$(date +%Y%m%d-%H%M%S)

mongodump --uri="mongodb://username:password@your-server:27017/" \
  --db=Media \
  --out=/var/backups/mongodb/media-backup-$(date +%Y%m%d-%H%M%S)

# Verify backup exists
ls -lh /var/backups/mongodb/
```

### Step 7: Test with Dry-Run

```bash
# Test migration without making changes
MIGRATION_DRY_RUN=true node migrate-to-better-auth.js

# Review output carefully:
# - Check user count
# - Verify preferences format
# - Confirm no errors
```

### Step 8: Run Actual Migration

```bash
# Run migration
node migrate-to-better-auth.js

# Watch for:
# ✅ "Migration complete" message
# ✅ User count verification passed
# ✅ Foreign key validation passed
# ❌ Any CRITICAL errors (stop if you see these)
```

### Step 9: Verify Migration

```bash
# Verify migration succeeded
MIGRATION_VERIFY_ONLY=true node migrate-to-better-auth.js

# Check output for:
# ✅ User count matches
# ✅ WatchHistory references valid
# ✅ PlaylistVisibility references valid
```

---

## Quick Production Commands

### One-Line Migration (after setup)

```bash
cd /var/www/migration && \
  MONGODB_URI="mongodb://user:pass@localhost:27017/" \
  MONGODB_AUTH_DB="Users" \
  MONGODB_DB="Media" \
  ADMIN_USER_EMAILS="admin@example.com" \
  node migrate-to-better-auth.js
```

### One-Line Dry-Run

```bash
cd /var/www/migration && \
  MONGODB_URI="mongodb://user:pass@localhost:27017/" \
  MONGODB_AUTH_DB="Users" \
  MONGODB_DB="Media" \
  ADMIN_USER_EMAILS="admin@example.com" \
  MIGRATION_DRY_RUN=true \
  node migrate-to-better-auth.js
```

### One-Line Verify

```bash
cd /var/www/migration && \
  MONGODB_URI="mongodb://user:pass@localhost:27017/" \
  MONGODB_AUTH_DB="Users" \
  MONGODB_DB="Media" \
  MIGRATION_VERIFY_ONLY=true \
  node migrate-to-better-auth.js
```

---

## Troubleshooting

### Error: "Cannot find module 'mongodb'"

```bash
cd /var/www/migration
npm install
```

### Error: "MONGODB_URI environment variable is required"

```bash
# Check if .env file exists
cat .env

# Or export environment variable
export MONGODB_URI="mongodb://..."
```

### Error: "MongoServerError: Authentication failed"

```bash
# Check MongoDB credentials
mongosh "mongodb://username:password@your-server:27017/" --eval "db.version()"

# Fix connection string format:
# mongodb://username:password@host:port/
# OR for MongoDB Atlas:
# mongodb+srv://username:password@cluster.mongodb.net/
```

### Error: "Collection does not exist"

```bash
# Verify source collections exist
mongosh "mongodb://..." --eval "use Users; db.getCollectionNames()"

# Should see: AuthenticatedUsers, SSOAccounts
```

### Migration completed but shows orphaned data

This is normal! Orphaned Watchlist/Playlists entries are from:
- Deleted test accounts
- Old users removed from system

Your **active users and WatchHistory are safe** (verified by automated checks).

---

## Post-Migration Checklist

### Immediately After Migration

- [ ] Check migration output for "✅ Migration complete"
- [ ] Verify user count matches expected number
- [ ] Check WatchHistory validation passed
- [ ] Note any orphaned data warnings (usually safe to ignore)

### Application Testing

- [ ] Update application `.env` with better-auth variables
- [ ] Restart application server
- [ ] Test Google OAuth login
- [ ] Test Discord OAuth login
- [ ] Verify admin user has admin access
- [ ] Check watch history displays correctly
- [ ] Verify playlists load
- [ ] Test "Resume Watching" feature

### Cleanup (After 30 Days)

```bash
# Only after confirming everything works!
mongosh "mongodb://..." << 'EOF'
use Users
db.AuthenticatedUsers_backup.drop()
db.SSOAccounts_backup.drop()
db.verificationTokens_backup.drop()
EOF
```

---

## Rollback Procedure (If Needed)

If something goes wrong:

```bash
# 1. Stop application
sudo systemctl stop your-app

# 2. Connect to MongoDB
mongosh "mongodb://your-connection-string"

# 3. Restore from backups
use Users

# Drop new collections
db.user.drop()
db.account.drop()

# Restore from backups
db.AuthenticatedUsers_backup.find().forEach(doc => db.AuthenticatedUsers.insert(doc))
db.SSOAccounts_backup.find().forEach(doc => db.SSOAccounts.insert(doc))

# 4. Restart application with old auth system
# (Revert code changes to use NextAuth.js)
```

---

## Security Notes

### Protect Sensitive Files

```bash
# Secure environment file
chmod 600 /var/www/migration/.env
chown root:root /var/www/migration/.env

# Secure backup directory
chmod 700 /var/backups/mongodb
```

### Use SSH Tunnel for Remote MongoDB

If MongoDB is on different server:

```bash
# Create SSH tunnel
ssh -L 27017:localhost:27017 user@mongodb-server -N &

# Then use:
# MONGODB_URI=mongodb://localhost:27017/
```

### Use MongoDB Connection String Authentication

```bash
# Include authSource if needed
mongodb://username:password@host:27017/?authSource=admin&authMechanism=SCRAM-SHA-256
```

---

## Summary

**Before Migration:**
- ✅ Node.js 18+ installed
- ✅ MongoDB accessible
- ✅ Users & Media databases exist
- ✅ Full database backup taken

**Run Migration:**
```bash
MIGRATION_DRY_RUN=true node migrate-to-better-auth.js  # Test first
node migrate-to-better-auth.js                          # Run migration
MIGRATION_VERIFY_ONLY=true node migrate-to-better-auth.js  # Verify
```

**After Migration:**
- ✅ Test application login
- ✅ Verify watch history
- ✅ Keep backups 30 days

**Questions?** Check [`plans/migration-review-findings.md`](../plans/migration-review-findings.md) for detailed analysis.
