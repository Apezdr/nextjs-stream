// Get the status of services
import clientPromise from '@src/lib/mongodb'

export const GET = async (req) => {
  try {
    const client = await clientPromise
    await client.db('app_config').command({ ping: 1 })
    return new Response(JSON.stringify({ ok: true, status: 'MongoDB connection successful', db: { statusText: 'Up', details: 'MongoDB is running' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: 'MongoDB connection failed', db: { statusText: 'Down', details: error.reason.error.name } }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}