import { isAuthenticatedAndApproved } from '@src/utils/routeAuth'
import { endPresenceSession } from '@src/utils/playbackPresence/database'
import { createLogger } from '@src/lib/logger'

const log = createLogger('API.PresenceEnd')

export const POST = async (req) => {
  const authResult = await isAuthenticatedAndApproved(req)
  if (authResult instanceof Response) {
    return authResult
  }

  try {
    const body = await req.json()
    const { sessionId } = body

    if (!sessionId || typeof sessionId !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid sessionId' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    await endPresenceSession({ userId: authResult.id, sessionId })

    return new Response(
      JSON.stringify({ message: 'Presence session ended' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    log.error({ error }, 'Failed to end presence session')
    return new Response(
      JSON.stringify({ error: 'Internal Server Error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
