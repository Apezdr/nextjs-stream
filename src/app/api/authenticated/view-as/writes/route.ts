// src/app/api/authenticated/view-as/writes/route.ts
// The "View as" bar's switch: writes on or off for this view-as session.
//
//   POST { enabled: boolean }   { viewAsWrites: boolean }
//
// The one way to change the setting (viewAsWrites.ts keeps it on the session).
// The guard lets this through while read-only (VIEW_AS_WRITES_SWITCH), so it
// checks for itself, from the session and the database, never the request:
// - the session is a view-as one (403 NOT_VIEWING_AS otherwise)
// - the admin it names (impersonatedBy), read again from the database, is
//   still an admin (403 ADMIN_REQUIRED otherwise: the role may have gone
//   since the view began)
// Every change, and every refusal past the first check, is logged with both
// users' ids (viewAsAudit.ts).
import { getSession } from '@src/lib/cachedAuth'
import { isAdminUser, isImpersonating } from '@src/lib/roles/rules'
import { userQueries } from '@src/lib/userQueries'
import { setViewAsWrites } from '@src/lib/viewAsWrites'
import { auditViewAsWritesRefused, auditViewAsWritesSwitch } from '@src/lib/viewAsAudit'
import { createLogger } from '@src/lib/logger'

const log = createLogger('Auth.ViewAs')

const refuse = (status: number, error: string, message: string) => Response.json({ error, message }, { status })

export async function POST(request: Request) {
  const session = await getSession()
  if (!isImpersonating(session)) {
    return refuse(403, 'NOT_VIEWING_AS', 'Only a "View as" session has this switch.')
  }

  // JSON only: a cross-site form can't send it without the browser asking first
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return refuse(415, 'JSON_REQUIRED', 'Send { "enabled": true | false } as JSON.')
  }
  const body = await request.json().catch(() => null)
  if (typeof body?.enabled !== 'boolean') {
    return refuse(400, 'INVALID_BODY', 'Send { "enabled": true | false }.')
  }

  try {
    const admin = await userQueries.findById(session.session.impersonatedBy, { role: 1 })
    if (!isAdminUser(admin)) {
      auditViewAsWritesRefused(session, 'not an admin any more', log)
      return refuse(403, 'ADMIN_REQUIRED', 'The admin viewing as this user is no longer an admin.')
    }

    if (!(await setViewAsWrites(session.session.token, String(session.user.id), body.enabled))) {
      auditViewAsWritesRefused(session, 'the session has ended', log)
      return refuse(409, 'SESSION_ENDED', 'This view-as session has ended.')
    }
  } catch (error) {
    log.error({ error: (error as Error)?.message }, 'View as: writes switch failed')
    return refuse(500, 'SWITCH_FAILED', 'Could not change the setting. Try again.')
  }

  auditViewAsWritesSwitch(session, body.enabled, log)
  return Response.json({ viewAsWrites: body.enabled })
}
