// src/app/api/public/delete-request/route.js
// The public form's request to delete an account, by email address
// (/privacy/delete-account): for someone who cannot sign in.
//
//   POST { email, reason? }   { success: true, message }
//
// Nobody signs in here and the app sends no mail, so nothing proves the
// address belongs to whoever typed it. The request is therefore only recorded
// (accountDeletion.js createPublicDeletionRequest): it waits for an admin on
// the Deletion Requests page, marked as coming from this form, and the
// account's owner is told in the app and can cancel it.
//
// A well-formed request gets ONE answer, whether or not an account has the
// address and whether or not its deletion was already requested: this form
// must not tell a stranger who has an account here. Keep it that way: no
// status in the answer, no "not found", no "already requested", and no GET
// that looks a request up by address.
//
// Limited to a few requests an hour per address the request came from, counted
// before the email is read, so the limit says nothing about the email either.
import { createPublicDeletionRequest } from '@src/utils/accountDeletion'
import {
  sendAdminDeletionRequestNotification,
  sendDeletionRequestConfirmation
} from '@src/utils/deletionEmailService'
import {
  checkRateLimit,
  createRateLimitHeaders,
  getClientIP,
  RATE_LIMITS
} from '@src/utils/rateLimiter'
import { createLogger } from '@src/lib/logger'

const log = createLogger('API.Public.DeleteRequest')

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_EMAIL_LENGTH = 254
const MAX_REASON_LENGTH = 500

/** The answer to every well-formed request. */
const RECEIVED = {
  success: true,
  message:
    'If an account uses that email address, its deletion request is now with the admins. No email is sent.'
}

const refuse = (status, error, extra = {}, headers = undefined) =>
  Response.json({ error, ...extra }, { status, headers })

/** The account's owner and the admins, in the app. A notification that fails does not undo the request. */
async function notify(deletionRequest) {
  const requestId = String(deletionRequest._id)
  try {
    await sendDeletionRequestConfirmation(deletionRequest.userId.toString(), deletionRequest)
  } catch (error) {
    log.error({ requestId, error: error?.message }, 'Could not tell the account about its deletion request')
  }
  try {
    await sendAdminDeletionRequestNotification(deletionRequest)
  } catch (error) {
    log.error({ requestId, error: error?.message }, 'Could not tell the admins about a deletion request')
  }
}

export async function POST(request) {
  const rateLimit = checkRateLimit(request, RATE_LIMITS.DELETION_REQUEST, 'deletion')
  if (rateLimit.isLimited) {
    return refuse(
      429,
      'Too many deletion requests from this address. Try again later.',
      { retryAfter: rateLimit.retryAfter },
      createRateLimitHeaders(rateLimit)
    )
  }

  const body = await request.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  const reason = body?.reason ?? null

  if (email === '') {
    return refuse(400, 'Email address is required')
  }
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL.test(email)) {
    return refuse(400, 'Invalid email format')
  }
  if (reason !== null && typeof reason !== 'string') {
    return refuse(400, 'Reason must be a string')
  }
  if (reason !== null && reason.length > MAX_REASON_LENGTH) {
    return refuse(400, `Reason must be at most ${MAX_REASON_LENGTH} characters`)
  }

  const clientIp = getClientIP(request)
  try {
    const deletionRequest = await createPublicDeletionRequest(
      email,
      reason?.trim() || null,
      clientIp === 'unknown' ? null : clientIp
    )
    if (deletionRequest) {
      // The request's id, never the email
      log.info({ requestId: String(deletionRequest._id) }, 'A deletion request was made on the public form')
      await notify(deletionRequest)
    }
  } catch (error) {
    log.error({ error: error?.message }, 'A deletion request from the public form could not be recorded')
    return refuse(500, 'The request could not be recorded. Try again later.')
  }

  return Response.json(RECEIVED)
}
