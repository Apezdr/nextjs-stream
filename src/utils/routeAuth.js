import { auth } from '@src/lib/auth'
import { headers } from 'next/headers'
import clientPromise from '@src/lib/mongodb'
import { ObjectId } from 'mongodb'
import { validateWebhookId } from './webhookServer'
import { getSession } from '@src/lib/cachedAuth'
import { userQueries } from '@src/lib/userQueries'

function unauthorizedResponse(message = 'You must be signed in.') {
  return new Response(
    JSON.stringify({ success: false, error: 'Unauthorized', message, code: 'AUTH_REQUIRED' }),
    { status: 401, headers: { 'Content-Type': 'application/json' } }
  )
}

function adminUnauthorizedResponse() {
  return new Response(
    JSON.stringify({ success: false, error: 'Unauthorized', message: 'Admin access required.' }),
    { status: 401, headers: { 'Content-Type': 'application/json' } }
  )
}

/**
 * Authenticate an incoming API request via cookie session or bearer token.
 * Returns the user object or a Response if unauthorized.
 */
export default async function isAuthenticated(req) {
  const session = await getSession();
  if (!session?.user) return unauthorizedResponse()
  return session.user
}

/**
 * Authenticate and require admin role.
 * Omit req to read headers() for RSC/server-action contexts.
 */
export async function isAdmin(req = false) {
  const session = await getSession();
  if (!session?.user || session.user.role !== 'admin') return adminUnauthorizedResponse()
  return session.user
}

/**
 * Authenticate as admin OR via valid webhook ID.
 */
export async function isAdminOrWebhook(req) {
  const webhookId = req.headers?.get('X-Webhook-ID') || req.query?.webhookId || false
  if (webhookId) {
    const validationResult = await validateWebhookId(webhookId)
    if (validationResult.isValid) {
      req.webhookServerId = validationResult.serverId
      return true
    }
    return new Response(
      JSON.stringify({ success: false, message: 'Invalid webhook identifier.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    )
  }
  return isAdmin(req)
}

export async function isValidWebhook(req) {
  const webhookId = req.headers?.get('X-Webhook-ID') || req.query?.webhookId || false
  if (webhookId) {
    const validationResult = await validateWebhookId(webhookId)
    if (validationResult.isValid) {
      req.webhookServerId = validationResult.serverId
      return true
    }
  }
  return false
}

/**
 * Authenticate mobile/TV clients sending Authorization: Bearer <token>.
 * The bearer plugin makes auth.api.getSession() read the Authorization header
 * automatically — device auth tokens and cookie sessions are both handled.
 */
export async function isAuthenticatedBySessionId(req) {
  const session = await getSession();
  if (!session?.user) {
    return new Response(
      JSON.stringify({ error: 'No valid authentication provided' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    )
  }
  return session.user
}

/**
 * Server-side auth for RSCs and server actions (reads next/headers directly).
 */
export async function isAuthenticatedServer() {
  const session = await getSession();
  if (!session?.user) return unauthorizedResponse()
  return session.user
}

/**
 * Authenticate and require user to be approved.
 * Returns the user object or a Response if unauthorized/not approved.
 */
export async function isAuthenticatedAndApproved(req) {
  const session = await getSession();
  if (!session?.user) return unauthorizedResponse()
  
  if (session.user.approved === false) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Unauthorized',
        message: 'Account approval required.',
        code: 'APPROVAL_PENDING'
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    )
  }
  
  return session.user
}
/**
 * Authenticate and check for limited access restrictions.
 * Returns the user object or a Response if unauthorized/limited access denied.
 */
export async function isAuthenticatedWithFullAccess(req) {
  const session = await getSession();
  if (!session?.user) return unauthorizedResponse()
  
  if (session.user.limitedAccess === true) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Unauthorized',
        message: 'Full access required.',
        code: 'LIMITED_ACCESS'
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    )
  }
  
  return session.user
}

/**
 * Fetch a raw user document from the database by userId string.
 */
export async function getUserById(userId) {
  const user = await userQueries.findById(userId)
  return user || null
}
