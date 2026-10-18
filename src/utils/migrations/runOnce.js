/**
 * Data migrations that apply themselves, once per database.
 *
 * This app is self-hosted, and a deployment has no one to run a command
 * against its database: every change to stored data ships as code that
 * applies itself the first time it runs there. A migration here is a function
 * that is safe to apply twice — two processes can start it at once, and one
 * that fails part way is applied again, whole, on the next call — and that
 * leaves a flag in `app_config.migrations` once it has finished. The flag is
 * written only after it has finished, so a migration that failed is retried.
 */

const FLAGS = 'migrations'

/** Per process: which migrations are known to be done, and which are running. */
function state() {
  globalThis.__dataMigrations ??= { done: new Set(), running: new Map() }
  return globalThis.__dataMigrations
}

/**
 * Whether this database has had a migration, without applying it.
 *
 * @param {import('mongodb').MongoClient} client
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function migrationApplied(client, id) {
  const s = state()
  if (s.done.has(id)) return true
  if (await client.db('app_config').collection(FLAGS).findOne({ _id: id })) {
    s.done.add(id)
    return true
  }
  return false
}

/**
 * Apply a migration unless this database has already had it. Throws whatever
 * the migration throws (and then writes no flag): the caller decides whether
 * that stops anything.
 *
 * @param {import('mongodb').MongoClient} client
 * @param {string} id - The migration's flag; never reused for a different migration
 * @param {() => Promise<Object>} apply - Idempotent; resolves to a summary stored with the flag
 * @returns {Promise<{applied: boolean, result?: Object}>} applied false when the flag was already there
 */
export async function runMigrationOnce(client, id, apply) {
  const s = state()
  if (s.done.has(id)) return { applied: false }
  if (!s.running.has(id)) {
    const run = (async () => {
      const flags = client.db('app_config').collection(FLAGS)
      if (await flags.findOne({ _id: id })) {
        s.done.add(id)
        return { applied: false }
      }
      const startedAt = new Date()
      const result = await apply()
      await flags.updateOne(
        { _id: id },
        { $set: { startedAt, appliedAt: new Date(), result: result ?? null } },
        { upsert: true }
      )
      s.done.add(id)
      return { applied: true, result }
    })()
    s.running.set(id, run)
    run.then(
      () => s.running.delete(id),
      () => s.running.delete(id)
    )
  }
  return s.running.get(id)
}
