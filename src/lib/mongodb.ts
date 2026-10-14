import { MongoClient, type MongoClientOptions } from 'mongodb'

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017' // your mongodb connection string

// Parse a positive integer from env, falling back when unset/invalid (allows 0).
const envInt = (value: string | undefined, fallback: number): number => {
  const n = value === undefined ? NaN : Number(value)
  return Number.isFinite(n) ? n : fallback
}

// Connection-pool tuning.
//
// The driver defaults (minPoolSize: 0, lazy pool) let the pool drain to zero
// between traffic bursts, so the FIRST database operation of a request — usually
// getSession() at the start of an RSC render — had to establish a brand-new
// authenticated connection (TCP + SCRAM handshake + server selection) on the hot
// path. In production that surfaced as intermittent ~3s stalls that blocked the
// whole /list render (the session query itself was ~4ms). Keeping a warm,
// authenticated baseline pool moves that cost off the request path; the pool
// maintainer establishes and replenishes connections in the background.
const options: MongoClientOptions = {
  // Warm, authenticated connections kept ready at all times (background-filled),
  // so a request checks out an open connection instead of creating one.
  minPoolSize: envInt(process.env.MONGODB_MIN_POOL_SIZE, 10),
  // Upper bound for concurrency bursts (e.g. the ~70 parallel queries a single
  // landing-page render fans out).
  maxPoolSize: envInt(process.env.MONGODB_MAX_POOL_SIZE, 100),
  // Recycle idle connections before a NAT/Docker bridge can silently drop them;
  // the maintainer keeps minPoolSize warm with fresh sockets.
  maxIdleTimeMS: envInt(process.env.MONGODB_MAX_IDLE_TIME_MS, 60_000),
  // Fail fast (instead of the 30s default) if the standalone is briefly
  // unreachable — pages already stream a skeleton while this resolves.
  serverSelectionTimeoutMS: envInt(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS, 10_000),
  // Bound the two waits the driver defaults to INFINITY. Without these, an
  // operation whose pool is saturated, or whose checked-out socket never gets
  // a reply (e.g. mongod dies mid-command), parks forever with no error and
  // no log — a 2026-07-14 sync held its in-memory gate for 10 hours this way.
  waitQueueTimeoutMS: envInt(process.env.MONGODB_WAIT_QUEUE_TIMEOUT_MS, 30_000),
  socketTimeoutMS: envInt(process.env.MONGODB_SOCKET_TIMEOUT_MS, 120_000),
  // Tag connections so they're attributable in mongod logs / metrics.
  appName: 'nextjs-stream',
}

// Sync-dedicated pool. The multi-server sync's bulk phases fan out enough
// concurrent operations to exhaust the shared request-serving pool — observed
// in production as request queries queueing 4-5s for a connection checkout
// mid-tick while the query itself ran in single-digit milliseconds. Routing
// the sync's repositories through their own client caps sync's blast radius
// at its own pool and leaves the pool above exclusively serving requests.
//
// minPoolSize defaults to 0: syncs run every ~3 minutes and maxIdleTimeMS
// drains idle sockets after 60s, so warm connections would be re-established
// each tick anyway — the background pool fill at tick start is cheap and
// beats holding 40 idle connections around the clock.
const syncOptions: MongoClientOptions = {
  minPoolSize: envInt(process.env.MONGODB_SYNC_MIN_POOL_SIZE, 0),
  maxPoolSize: envInt(process.env.MONGODB_SYNC_MAX_POOL_SIZE, 40),
  maxIdleTimeMS: envInt(process.env.MONGODB_SYNC_MAX_IDLE_TIME_MS, 60_000),
  serverSelectionTimeoutMS: envInt(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS, 10_000),
  // Longer bounds than the request pool (bulk writes and index builds run for
  // a while), but still finite — see the request-pool comment. A parked sync
  // op must eventually reject so the sync settles and releases its gate.
  waitQueueTimeoutMS: envInt(process.env.MONGODB_SYNC_WAIT_QUEUE_TIMEOUT_MS, 60_000),
  socketTimeoutMS: envInt(process.env.MONGODB_SYNC_SOCKET_TIMEOUT_MS, 300_000),
  // Distinct appName so sync traffic is attributable in mongod logs/metrics.
  appName: 'nextjs-stream-sync',
}

declare global {
  // One client per pool per process, in every environment. The production
  // build bundles this module twice (once for server components, once for
  // route handlers), and before 2026-10-14 each copy built its own client,
  // pool and failure state. In development the global also survives HMR
  // reloads, so a file change doesn't open another pool.
  var _mongoClient: MongoClient | undefined
  var _mongoSyncClient: MongoClient | undefined
}

function sharedClient(
  key: '_mongoClient' | '_mongoSyncClient',
  opts: MongoClientOptions
): MongoClient {
  return (globalThis[key] ??= new MongoClient(uri, opts))
}

/**
 * Await-able handle that calls connect() on every acquisition instead of
 * replaying one stored result. The old module kept the boot-time connect()
 * promise, so a boot that raced mongod's startup rejected every later
 * `await clientPromise` with the same ECONNREFUSED for the life of the
 * process (2026-10-14: 16 minutes of route-handler failures after mongod was
 * up). Driver 7.x connect() returns at once when connected, shares one
 * in-flight attempt between concurrent callers, and builds a fresh topology
 * after a failed one.
 */
function connectOnUse(client: MongoClient): Promise<MongoClient> {
  const acquire = () => client.connect()
  const handle: Promise<MongoClient> = {
    then: (onFulfilled, onRejected) => acquire().then(onFulfilled, onRejected),
    catch: (onRejected) => acquire().catch(onRejected),
    finally: (onFinally) => acquire().finally(onFinally),
    [Symbol.toStringTag]: 'MongoClientHandle',
  }
  return handle
}

// Connect at boot so minPoolSize is warm before traffic, and keep retrying
// until one attempt succeeds. better-auth and userQueries use mongoClient
// directly, and after a failed connect() the driver keeps the closed topology:
// its auto-connect only runs when there is no topology at all, so every
// operation throws MongoTopologyClosedError until another connect() replaces it.
const BOOT_CONNECT_RETRY_MS = 5_000
function connectUntilUp(client: MongoClient): void {
  client.connect().catch(() => {
    setTimeout(() => connectUntilUp(client), BOOT_CONNECT_RETRY_MS).unref()
  })
}

// Synchronous client reference — used where a Db instance is needed synchronously
export const mongoClient = sharedClient('_mongoClient', options)

const clientPromise = connectOnUse(mongoClient)

// Export a module-scoped MongoClient handle. By doing this in a
// separate module, the client can be shared across functions.
export default clientPromise

connectUntilUp(mongoClient)

/**
 * Sync-dedicated MongoClient (lazy — the pool is only created when the sync
 * path first asks for it). Use ONLY for sync bulk work; request-serving code
 * stays on the default export's pool.
 */
export function getSyncClientPromise(): Promise<MongoClient> {
  return connectOnUse(sharedClient('_mongoSyncClient', syncOptions))
}
