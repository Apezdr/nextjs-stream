// src/lib/roles/session.ts
// The signed-in user's permissions and library access, for routes and server
// components.
import 'server-only'
import { cacheLife } from 'next/cache'
import { getSession } from '@src/lib/cachedAuth'
import { libraryAccessFor } from './libraryAccess'
import { FULL_LIBRARY, type LibraryAccess } from './libraryScope'
import { permissionsFor, type Permissions } from './resolve'

/** Null when nobody is signed in. */
export async function currentPermissions(): Promise<Permissions | null> {
  const session = await getSession()
  return session?.user ? permissionsFor(session.user) : null
}

/** The signed-in user's library access, or null when nobody is signed in. For Route Handlers. */
export async function currentLibraryAccess(): Promise<LibraryAccess | null> {
  const session = await getSession()
  return session?.user ? libraryAccessFor(session.user) : null
}

/**
 * The signed-in user's library access for what a page renders outside its
 * SessionGate: the /list banner and a title page's <head>. Cached as
 * getChromeSession is (cachedAuth.js), so it can ride a prefetch: nothing is
 * stored on the server, only the browser may reuse it for 30 seconds. Null
 * when nobody is signed in.
 */
export async function viewerLibraryAccess(): Promise<LibraryAccess | null> {
  'use cache: private'
  cacheLife({ stale: 30 })
  return currentLibraryAccess()
}

/**
 * The library access a title page's <head> (generateMetadata) is built for:
 * the signed-in viewer's, so a title outside their scope never names itself in
 * their tab. A visitor with no session gets the whole library, as before: link
 * previews read a page's metadata without one.
 */
export async function pageLibraryAccess(): Promise<LibraryAccess> {
  return (await viewerLibraryAccess()) ?? FULL_LIBRARY
}

/**
 * The signed-in caller's library access, or the whole library for a request
 * with no session, for the places that serve signed-out callers on purpose: a
 * player page's sign-in teaser (a poster and the title, nothing that plays),
 * and the routes the player and the Cast receiver fetch side files from
 * without a session (subtitles, chapters, caption tracks), whose files the
 * file server hands to anyone anyway. A signed-in caller is always held to
 * their scope.
 */
export async function libraryAccessOrPublic(): Promise<LibraryAccess> {
  return (await currentLibraryAccess()) ?? FULL_LIBRARY
}
