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
  // Tag connections so they're attributable in mongod logs / metrics.
  appName: 'nextjs-stream',
}

declare global {
  // Cached across HMR reloads in development so we don't open a new pool (and
  // leak minPoolSize connections) on every file change. Unused in production,
  // where the module singleton persists for the process lifetime.
  var _mongoClient: MongoClient | undefined
  var _mongoClientPromise: Promise<MongoClient> | undefined
}

class Singleton {
  private static _instance: Singleton
  private client: MongoClient
  private clientPromise: Promise<MongoClient>
  private constructor() {
    if (
      process.env.NODE_ENV === 'development' &&
      global._mongoClient &&
      global._mongoClientPromise
    ) {
      // Reuse the existing client/pool across HMR reloads.
      this.client = global._mongoClient
      this.clientPromise = global._mongoClientPromise
    } else {
      this.client = new MongoClient(uri, options)
      this.clientPromise = this.client.connect()
      if (process.env.NODE_ENV === 'development') {
        // In development mode, use a global variable so that the value
        // is preserved across module reloads caused by HMR (Hot Module Replacement).
        global._mongoClient = this.client
        global._mongoClientPromise = this.clientPromise
      }
    }
  }

  public static get instance() {
    if (!this._instance) {
      this._instance = new Singleton()
    }
    return this._instance.clientPromise
  }

  public static get client(): MongoClient {
    if (!this._instance) {
      this._instance = new Singleton()
    }
    return this._instance.client
  }
}
const clientPromise = Singleton.instance

// Export a module-scoped MongoClient promise. By doing this in a
// separate module, the client can be shared across functions.
export default clientPromise

// Synchronous client reference (connected lazily) — used where a Db instance is needed synchronously
export const mongoClient = Singleton.client
