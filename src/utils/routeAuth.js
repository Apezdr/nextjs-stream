import { auth, getUserBySessionId, verifyMobileToken, getUserByMobileToken } from '@src/lib/auth'
import { buildURL } from '.'
import { adminUserEmails } from './config'
import axios from 'axios'
import { validateWebhookId } from './webhookServer'

export default async function isAuthenticated(req) {
  try {
    const sessionResponse = await fetch(buildURL(`/api/auth/session`), {
      headers: {
        cookie: req.headers.get('cookie') || '', // Forward the cookies from the original request
      },
    })

    let session
    try {
      session = await sessionResponse.json()
    } catch (parseError) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Authentication Error',
          message: 'Failed to parse session response',
          code: 'AUTH_PARSE_FAILED',
          details: parseError?.message
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (!session || !session.user) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Unauthorized',
          message: 'You must be signed in.',
          code: 'AUTH_REQUIRED'
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }
    return session.user
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Authentication Error',
        message: 'Failed to fetch session',
        code: 'AUTH_FETCH_FAILED',
        details: error?.message
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

export async function isAdminOrWebhook(req) {
  // First, check for webhook identifier
  const webhookId = req.headers?.get('X-Webhook-ID') || req.query?.webhookId || false // Note: Header names are case-insensitive in HTTP
  if (webhookId) {
    const validationResult = await validateWebhookId(webhookId)
    if (validationResult.isValid) {
      // Add server information to the request for downstream processing
      req.webhookServerId = validationResult.serverId
      return true // Valid webhook ID, proceed with the request
    } else {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Invalid webhook identifier.',
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }
  } else {
    // If webhook ID is not valid or not provided, attempt to authenticate as admin
    const authResult = await isAdmin(req)
    if (authResult instanceof Response) {
      // Admin authentication failed, return the failure response
      return authResult
    } else if (authResult) {
      // Admin authentication succeeded, return the success response
      return true
    }
  }
}

export async function isAdmin(req = false, redirect = true) {
  let sessionResponse
  //
  if (req) {
    try {
      sessionResponse = await axios.get(buildURL(`/api/auth/session`), {
        headers: {
          cookie: req.headers.get('cookie') || '', // Forward the cookies from the original request
        },
      })
    } catch (error) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Authentication Error',
          message: 'Failed to fetch session',
          code: 'AUTH_FETCH_FAILED',
          details: error?.message
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }
  }

  let session = sessionResponse.data
  if (!session || !session.user) {
    session = await auth()
  }
  if (redirect && (!session || !session.user || !adminUserEmails.includes(session.user.email))) {
    return new Response('You must be signed in as an admin.', {
      status: 401,
      url: buildURL(`/api/auth/session`),
    })
  }
  return session.user
}

export async function isValidWebhook(req) {
  const webhookId = req.headers?.get('X-Webhook-ID') || req.query?.webhookId || false
  if (webhookId) {
    const validationResult = await validateWebhookId(webhookId)
    if (validationResult.isValid) {
      // Add server information to the request for downstream processing
      req.webhookServerId = validationResult.serverId
      return true
    }
  }
  return false
}

// Specifically for mobile/TV client authentication (JWT tokens and session IDs)
export async function isAuthenticatedBySessionId(req) {
  // First, try JWT token authentication (primary method for mobile/TV)
  const authHeader = req.headers.get('authorization')
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7)
    try {
      // Use the new function that properly looks up the user by mobile token
      const user = await getUserByMobileToken(token)
      if (user) return user
    } catch (error) {
      console.error('JWT token verification failed:', error)
      // Continue to try session ID authentication as fallback
    }
  }
  
  // Fallback: try session ID authentication
  const sessionId = req.headers.get('x-session-id') || 
                    new URL(req.url).searchParams.get('sessionId')
  
  if (!sessionId) {
    return new Response(
      JSON.stringify({ error: 'No valid authentication provided' }), 
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    )
  }
  
  try {
    const user = await getUserBySessionId(sessionId)
    if (user) return user
    return new Response(
      JSON.stringify({ error: 'Invalid session ID' }), 
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('SessionId auth failed:', error)
    return new Response(
      JSON.stringify({ error: 'Authentication failed' }), 
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// Combined method as a separate function
export async function isAuthenticatedEither(req) {
  // First try web session
  const webAuthResult = await isAuthenticated(req)
  if (!(webAuthResult instanceof Response)) {
    return webAuthResult // User authenticated via web session
  }
  
  // If web auth failed, try session ID
  const sessionAuthResult = await isAuthenticatedBySessionId(req)
  return sessionAuthResult // Either user object or error response
}
