// src/utils/serverStatus.ts
import 'server-only'
import clientPromise from '@src/lib/mongodb'

export type ServerStatus =
  | { ok: true; status: string; db: { statusText: 'Up'; details: string } }
  | { ok: false; error: string; db: { statusText: 'Down'; details: string } }

function getErrorDetails(err: unknown) {
  if (err instanceof Error) return err.message
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

export async function getServerStatus(): Promise<ServerStatus> {
  try {
    const client = await clientPromise
    await client.db('app_config').command({ ping: 1 })

    return {
      ok: true,
      status: 'MongoDB connection successful',
      db: { statusText: 'Up', details: 'MongoDB is running' },
    }
  } catch (err) {
    return {
      ok: false,
      error: 'MongoDB connection failed',
      db: { statusText: 'Down', details: getErrorDetails(err) },
    }
  }
}
