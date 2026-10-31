'use client'

import { useSyncExternalStore } from 'react'
import { authClient } from '@src/lib/auth-client'

// Client-only mount flag, the same pattern GeneralLayout uses: the server
// snapshot is `false`, so SSR and the hydration render agree on "nothing".
const subscribeNever = () => () => {}

/**
 * Whether the signed-in viewer is an admin, and `false` until hydration.
 *
 * The info pages render inside `'use cache'` server subtrees shared by every
 * viewer, so admin-only pieces (the edit link, the watched-by list) must NOT be
 * decided on the server — that would bake one user's admin state into the
 * shared cache entry. The cached HTML is identical for everyone, and the role
 * check runs here, after hydration.
 *
 * The hydration gate is load-bearing: `useSession()` reads a global store, and
 * these pages stream in behind Suspense, so by the time a boundary hydrates the
 * nav has usually resolved the session already. Without the gate the first
 * client render shows the admin piece while the server HTML has nothing.
 *
 * @returns {boolean}
 */
export default function useIsAdminAfterHydration() {
  const { data: session } = authClient.useSession()
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false)
  return hydrated && session?.user?.role === 'admin'
}
