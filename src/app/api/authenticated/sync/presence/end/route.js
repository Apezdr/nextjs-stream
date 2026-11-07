import { approvedGate } from '@src/lib/roles/gates'
import { endPresenceSession } from '@src/utils/playbackPresence/database'
import { createLogger } from '@src/lib/logger'
import { refusePlaybackUserMismatch } from '@src/lib/playbackUser'

const log = createLogger('API.PresenceEnd')

export const POST = async (req) => {
  const authResult = await approvedGate.route()
  if (authResult instanceof Response) {
    return authResult
  }

  // Only the account the player's page was rendered for (playbackUser.ts)
  const mismatch = refusePlaybackUserMismatch(req, authResult.id, log)
  if (mismatch) return mismatch

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
