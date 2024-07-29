import { auth } from 'src/lib/auth'
import { buildURL } from '.'
import { adminUserEmails } from './config'
import axios from 'axios'

const webhookIds = process.env.VALID_WEBHOOK_IDS

export default async function isAuthenticated(req) {
  const sessionResponse = await fetch(buildURL(`/api/auth/session`), {
    headers: {
      cookie: req.headers.get('cookie') || '', // Forward the cookies from the original request
    },
  })
  const session = await sessionResponse.json()
  if (!session || !session.user) {
    throw new Response('You must be signed in.', { status: 401 })
  }
  return session.user
}

export async function isAdminOrWebhook(req) {
  // If webhook ID is not valid or not provided, attempt to authenticate as admin
  const authResult = await isAdmin(req)
  if (authResult instanceof Response) {
    // Admin authentication failed, return the failure response
    return authResult
  }
  else if (authResult) {
    // Admin authentication succeeded, return the success response
    return true
  }
  // First, check for webhook identifier
  const webhookId = req.headers?.get('x-webhook-id') || req.query?.webhookId || false // Note: Header names are case-insensitive in HTTP
  if (webhookId) {
    const isValidWebhookId = await validateWebhookId(webhookId) // Implement this function to validate the webhookId
    if (isValidWebhookId) {
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
  }
}

async function validateWebhookId(webhookId) {
  // Example validation logic
  // This could involve checking the ID against a database, a list of IDs, or verifying a signature
  const validWebhookIds = webhookIds?.split(',') || [] // Ideally, store and retrieve from a secure location
  return validWebhookIds.includes(webhookId)
}

export async function isAdmin(req) {
  let sessionResponse
  try {
    sessionResponse = await axios.get(buildURL(`/api/auth/session`), {
      headers: {
        cookie: req.headers.get('cookie') || '', // Forward the cookies from the original request
      },
    })
  } catch (error) {
    return new Response('Failed to fetch session.', { status: 500 })
  }

  let session = sessionResponse.data
  if (!session || !session.user) {
    session = await auth()
  }
  if (!session || !session.user || !adminUserEmails.includes(session.user.email)) {
    return new Response('You must be signed in as an admin.', { status: 401, url: buildURL(`/api/auth/session`) })
  }
  return session.user
}
