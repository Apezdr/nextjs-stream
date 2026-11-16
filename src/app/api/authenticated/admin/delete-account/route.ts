// src/app/api/authenticated/admin/delete-account/route.ts
// An admin deletes an account that did not ask to be deleted (the Users page's
// "Delete account").
//
//   POST { userId, confirmation, reason? }   { success: true, data: { requestId, deletionResults } }
//
// `confirmation` is what the admin typed into the dialog: the account's
// email, or the name (failing that the id) of an account that has no email
// (src/utils/deletionConfirmation.js). Checked here again, so a row that
// moved under the admin's cursor cannot delete someone else.
//
// One pipeline with the deletions users ask for (accountDeletion.js): the
// deletion is recorded as a request of type 'admin' and run at once, so the
// audit log names the admin, and a run that stops is on the Deletion Requests
// page to be run again. Nobody is notified.
//
// Refused:
// - anyone but an admin (the gate's own answer)
// - a "View as" session (403 VIEWING_AS). Such a session is the viewed user's,
//   and better-auth refuses to open one as an admin, so the gate has already
//   turned it away; this holds should the viewed user be made an admin while
//   the view is open. So `admin` below is always the admin's own session, and
//   "your own account" is theirs
// - a missing or malformed user id (400), an account that doesn't exist (404)
// - the admin's own account, and any admin's account (403)
// - a confirmation that is not the account's (400)
import { adminGate } from '@src/lib/roles/gates'
import { getSession } from '@src/lib/cachedAuth'
import { isImpersonating } from '@src/lib/roles/rules'
import { AccountDeletionIncomplete, AccountDeletionRefusal, deleteAccountAsAdmin } from '@src/utils/accountDeletion'
import { createLogger } from '@src/lib/logger'

const log = createLogger('API.Admin.DeleteAccount')

const MAX_REASON_LENGTH = 500

const REFUSAL_STATUS: Record<string, number> = {
  INVALID_USER_ID: 400,
  CONFIRMATION_MISMATCH: 400,
  USER_NOT_FOUND: 404,
  OWN_ACCOUNT: 403,
  TARGET_IS_ADMIN: 403,
}

const refuse = (status: number, error: string, message: string, extra: Record<string, unknown> = {}) =>
  Response.json({ success: false, error, message, ...extra }, { status })

export async function POST(request: Request) {
  const admin = await adminGate.route()
  if (admin instanceof Response) return admin

  if (isImpersonating(await getSession())) {
    return refuse(403, 'VIEWING_AS', 'Stop viewing as another user before deleting an account.')
  }

  // JSON only: a cross-site form can't send it without the browser asking first
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return refuse(415, 'JSON_REQUIRED', 'Send { "userId", "confirmation" } as JSON.')
  }
  const body = await request.json().catch(() => null)
  const userId = body?.userId
  const confirmation = body?.confirmation
  const reason = body?.reason ?? null

  if (typeof userId !== 'string' || userId.trim() === '') {
    return refuse(400, 'INVALID_USER_ID', 'A valid user id is required.')
  }
  if (typeof confirmation !== 'string' || confirmation.trim() === '') {
    return refuse(400, 'CONFIRMATION_REQUIRED', 'Type the confirmation the dialog asks for.')
  }
  if (reason !== null && (typeof reason !== 'string' || reason.length > MAX_REASON_LENGTH)) {
    return refuse(400, 'INVALID_REASON', `A reason is text of at most ${MAX_REASON_LENGTH} characters.`)
  }

  const adminId = String(admin.id)
  try {
    const { requestId, deletionResults } = await deleteAccountAsAdmin({
      userId,
      adminId,
      confirmation,
      reason: reason?.trim() || null,
    })
    // Ids only, never the email or the name
    log.info({ adminId, userId, requestId }, 'An admin deleted an account')
    return Response.json({ success: true, data: { requestId, deletionResults } })
  } catch (error) {
    if (error instanceof AccountDeletionRefusal) {
      log.warn({ adminId, userId, refusal: error.code }, 'An admin’s account deletion was refused')
      return refuse(REFUSAL_STATUS[error.code] ?? 400, error.code, error.message)
    }
    if (error instanceof AccountDeletionIncomplete) {
      log.error(
        { adminId, userId, requestId: error.requestId, error: (error.cause as Error)?.message },
        'An admin’s account deletion did not finish'
      )
      return refuse(500, 'DELETION_INCOMPLETE', 'The deletion did not finish. Run it again from Deletion Requests.', {
        requestId: error.requestId,
      })
    }
    log.error({ adminId, userId, error: (error as Error)?.message }, 'An admin’s account deletion failed')
    return refuse(500, 'DELETION_FAILED', 'The account could not be deleted. Nothing was removed.')
  }
}
