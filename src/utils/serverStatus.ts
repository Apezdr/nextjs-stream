// src/utils/serverStatus.ts
import 'server-only'
import clientPromise from '@src/lib/mongodb'
import { createLogger } from '@src/lib/logger'

const log = createLogger('ServerStatus')

/**
 * Upper bound on the whole check. `/api/status` is the TV app's liveness
 * probe, and the TV gives up on it after 8 s: an unreachable Mongo or a
 * saturated pool must answer 503 inside that window, not after the driver's
 * own waits (server selection 10 s, pool checkout 30 s — see lib/mongodb.ts).
 * The abandoned ping still ends on those driver timeouts.
 */
const PING_TIMEOUT_MS = 2_000

export type ServerStatus =
  | { ok: true; status: string; db: { statusText: 'Up'; details: string } }
  | { ok: false; error: string; db: { statusText: 'Down'; details: string } }

async function pingDatabase() {
  const client = await clientPromise
  await client.db('app_config').command({ ping: 1 })
}

export async function getServerStatus(): Promise<ServerStatus> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      pingDatabase(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Database ping exceeded ${PING_TIMEOUT_MS} ms`)),
          PING_TIMEOUT_MS
        )
      }),
    ])

    return {
      ok: true,
      status: 'MongoDB connection successful',
      db: { statusText: 'Up', details: 'MongoDB is running' },
    }
  } catch (error) {
    // Both callers are public (/api/status and the login page), and a driver
    // error can name internal hosts and ports — the detail stays in the log.
    log.warn({ err: error }, 'Database ping failed')
    return {
      ok: false,
      error: 'MongoDB connection failed',
      db: { statusText: 'Down', details: 'MongoDB is not responding' },
    }
  } finally {
    clearTimeout(timer)
  }
}
