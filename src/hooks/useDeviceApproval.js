'use client'
import { useReducer } from 'react'
import { authClient } from '@src/lib/auth-client'
import { deviceClientName } from '@src/lib/deviceClients'

/**
 * Approving a device sign-in (better-auth deviceAuthorization), shared by the
 * /device page and the account menu's Link a device dialog.
 *
 * review() calls GET /device first. While signed in, that claims the pending
 * code for this user, so only this user can approve or deny it
 * (GHSA-cq3f-vc6p-68fh), and it answers with the client the request came from
 * and the scope it asks for. The screen shows those, from the server's record,
 * before it offers Approve (GHSA-q84f-53jg-9ppm): approve only a request your
 * own app made. One call per code: the plugin rate-limits /device.
 *
 * state.phase: 'idle' | 'reviewing' | 'review' | 'approving' | 'denying' | 'approved' | 'denied'
 * state.request: { userCode, clientId, clientName, scope } once the request is claimed
 */

const MESSAGES = {
  'Invalid user code': 'Invalid or expired device code',
  'User code has expired': 'Device code has expired',
  'User code not found': 'Invalid or expired device code',
  'Device code already processed': 'This code has already been used. Get a new code on your device.',
  'Authentication required': 'Sign in to approve this device.',
  'You are not authorized to approve this device authorization': 'Another account is already approving this code.',
  'You are not authorized to deny this device authorization': 'Another account is already approving this code.',
}

/** A better-auth error, in words for the approver. */
export function deviceErrorMessage(error, fallback) {
  const raw = error?.error_description ?? error?.message ?? fallback
  return MESSAGES[raw] ?? raw
}

const initialState = { phase: 'idle', request: null, error: null }

function reducer(state, action) {
  switch (action.type) {
    case 'reviewStart':
      return { phase: 'reviewing', request: null, error: null }
    case 'reviewed':
      return { phase: 'review', request: action.request, error: null }
    case 'decideStart':
      return { ...state, phase: action.decision === 'approve' ? 'approving' : 'denying', error: null }
    case 'decided':
      return { ...state, phase: action.decision === 'approve' ? 'approved' : 'denied' }
    case 'reviewFailed':
      return { phase: 'idle', request: null, error: action.error }
    case 'decideFailed':
      return { ...state, phase: 'review', error: action.error }
    case 'reset':
      return initialState
    default:
      return state
  }
}

export function useDeviceApproval() {
  const [state, dispatch] = useReducer(reducer, initialState)

  /** Claims the code for this user and loads what the request asks for. */
  const review = async (rawCode) => {
    const userCode = String(rawCode ?? '').trim().toUpperCase()
    if (!userCode) {
      dispatch({ type: 'reviewFailed', error: 'Please enter the code shown on your device.' })
      return
    }
    dispatch({ type: 'reviewStart' })
    try {
      const { data, error } = await authClient.device({ query: { user_code: userCode } })
      if (error) throw new Error(deviceErrorMessage(error, 'Invalid or expired device code'))
      if (data?.status === 'approved' || data?.status === 'denied') {
        throw new Error('This code has already been used. Get a new code on your device.')
      }
      // client_id comes back only to the account that claimed the request
      if (!data?.client_id) throw new Error('Another account is already approving this code.')
      dispatch({
        type: 'reviewed',
        // clientName is null for an id this server doesn't know (auth.ts refuses
        // those at /device/code, so only a request from before that check)
        request: { userCode, clientId: data.client_id, clientName: deviceClientName(data.client_id), scope: data.scope || null },
      })
    } catch (err) {
      dispatch({ type: 'reviewFailed', error: err instanceof Error ? err.message : 'An error occurred' })
    }
  }

  const decide = async (decision) => {
    const userCode = state.request?.userCode
    if (!userCode) return
    // Never approve a request from an app this server can't name
    if (decision === 'approve' && !state.request.clientName) return
    dispatch({ type: 'decideStart', decision })
    try {
      const call = decision === 'approve' ? authClient.device.approve : authClient.device.deny
      const { error } = await call({ userCode })
      if (error) {
        throw new Error(deviceErrorMessage(error, decision === 'approve' ? 'Failed to approve device' : 'Failed to deny device'))
      }
      dispatch({ type: 'decided', decision })
    } catch (err) {
      dispatch({ type: 'decideFailed', error: err instanceof Error ? err.message : 'An error occurred' })
    }
  }

  return {
    ...state,
    review,
    approve: () => decide('approve'),
    deny: () => decide('deny'),
    reset: () => dispatch({ type: 'reset' }),
  }
}
