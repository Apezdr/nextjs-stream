import { connection } from 'next/server'
import { getSession } from '@src/lib/cachedAuth'
import { isAdminUser, isImpersonating, isViewAsWritesOn } from '@src/lib/roles/rules'
import ViewAsBannerClient from './ViewAsBannerClient'

/**
 * "Viewing as <name> · Read-only · Writes on · Stop", on every page while the
 * session is a view-as one, red ("Writing as <name>") while writes are on.
 * Mounted in the root layout, in its own Suspense boundary.
 *
 * It reads the live session (getSession), never getChromeSession: the chrome
 * may be reused by the browser for 30 s, and a banner from it could outlast a
 * Stop or miss a start. Start and Stop both load a new document
 * (viewAsClient.js), and this layout renders for each one, so it always shows
 * the session that document was rendered for. A client navigation keeps the
 * layout; the session changes under it only by another tab's start or stop,
 * which reloads this tab too, or by the hour running out, when Stop says so
 * and offers to sign out. The writes switch reloads every tab as well, so the
 * bar's colour is always the session's setting.
 */
export default async function ViewAsBanner() {
  // Request time only, like the status banner: the session check reads the clock
  await connection()
  const session = await getSession()
  if (!session?.user) return null

  if (isImpersonating(session)) {
    const { name, email } = session.user
    return <ViewAsBannerClient viewingAs={name || email || 'another user'} writesOn={isViewAsWritesOn(session)} />
  }
  // An admin's tabs reload when "View as" starts in another tab
  return isAdminUser(session.user) ? <ViewAsBannerClient viewingAs={null} /> : null
}
