'use client'

// Starting and stopping "View as" from the browser, and its writes switch:
// better-auth's admin plugin swaps the session cookie (impersonate-user parks
// the admin's own session in its admin_session cookie; stop-impersonating
// puts it back).
//
// Both end in a full-page navigation, never a router push. Everything the
// client router holds was rendered for the previous user: the cached
// segments, the nav chrome the browser may reuse for 30 s
// (getChromeSession), the root layout with the banner (or without it). A new
// document is rendered for the new session from scratch.
//
// This browser's other tabs are told too, and reload: their pages were
// rendered for whoever was signed in before, and a tab that went on showing
// the admin's chrome while acting as the user (or the banner after a stop)
// would mislead. Nothing reads the message but a reload; what each tab shows
// still comes from its session.
import { authClient } from '@src/lib/auth-client'
import { clearPlaybackMirror } from '@components/SyncClientWithServerWatched'

/** Where "View as" lands: the library home, as the user sees it. */
export const VIEW_AS_LANDING = '/list'
/** Where Stop goes back to. */
export const VIEW_AS_RETURN = '/admin/users'

const CHANNEL_NAME = 'nextjs-stream.view-as'

// One channel per tab: a message never comes back to the object that posted
// it, so the tab that switched doesn't reload itself mid-navigation
let channel = null
function viewAsChannel() {
  if (typeof BroadcastChannel === 'undefined') return null
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME)
  return channel
}

/** Reloads this tab when another tab of this browser starts or stops "View as". Returns the unsubscribe. */
export function reloadOnViewAsSwitch() {
  const tabs = viewAsChannel()
  if (!tabs) return () => {}
  const listener = () => window.location.reload()
  tabs.addEventListener('message', listener)
  return () => tabs.removeEventListener('message', listener)
}

/** A full-page navigation: a new document for the new session. */
export function navigateFully(href) {
  window.location.assign(href)
}

function tellOtherTabs() {
  try {
    viewAsChannel()?.postMessage('switched')
  } catch {
    // Other tabs then show the change on their next full load
  }
}

function switched(href) {
  // The last user's positions would stay behind as this browser's resume points
  clearPlaybackMirror()
  tellOtherTabs()
  navigateFully(href)
}

const failure = (error, fallback) => ({ ok: false, error: error?.message || fallback, status: error?.status ?? null })

/** Starts viewing as the user. Resolves { ok: true } as the page leaves, or { ok: false, error }. */
export async function startViewAs(userId) {
  try {
    const { error } = await authClient.admin.impersonateUser({ userId })
    if (error) return failure(error, 'The server refused.')
  } catch (error) {
    return failure(error, 'The server could not be reached.')
  }
  switched(VIEW_AS_LANDING)
  return { ok: true }
}

/** Stops viewing as, back to the admin's own session on the Users page. */
export async function stopViewAs() {
  try {
    const { error } = await authClient.admin.stopImpersonating()
    if (error) return failure(error, 'The server refused.')
  } catch (error) {
    return failure(error, 'The server could not be reached.')
  }
  switched(VIEW_AS_RETURN)
  return { ok: true }
}

/** The bar's switch (src/app/api/authenticated/view-as/writes). */
export const VIEW_AS_WRITES_URL = '/api/authenticated/view-as/writes'

/**
 * Turns writes on or off for this view-as session; the server keeps the
 * setting with the session. Then this tab reloads, and the others too: every
 * page was rendered for the old setting (the bar's colour, whether the watch
 * page minted a Cast token). Resolves { ok: true } as the page reloads, or
 * { ok: false, error, status }.
 */
export async function setViewAsWrites(enabled) {
  try {
    const response = await fetch(VIEW_AS_WRITES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: enabled === true }),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      return failure({ message: body?.message, status: response.status }, 'The server refused.')
    }
  } catch (error) {
    return failure(error, 'The server could not be reached.')
  }
  tellOtherTabs()
  window.location.reload()
  return { ok: true }
}

/**
 * Signs out: the way out when Stop fails (the admin's own session has ended
 * or was revoked, so there is nothing to go back to). Ends the view-as session.
 */
export async function signOutOfViewAs() {
  try {
    const { error } = await authClient.signOut()
    if (error) return failure(error, 'The server refused.')
  } catch (error) {
    return failure(error, 'The server could not be reached.')
  }
  switched('/auth/signin')
  return { ok: true }
}
