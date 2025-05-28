import { auth } from '@src/lib/auth'
import { buildURL } from '.'
import { adminUserEmails } from './config'
import axios from 'axios'
import { validateWebhookId } from './webhookServer'

export default async function isAuthenticated(req) {
  const sessionResponse = await fetch(buildURL(`/api/auth/session`), {
    headers: {
      cookie: req.headers.get('cookie') || '', // Forward the cookies from the original request
    },
  })
  const session = await sessionResponse.json()
  if (!session || !session.user) {
    return new Response('You must be signed in.', { status: 401 })
  }
  return session.user
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
      return new Response('Failed to fetch session.', { status: 500 })
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
