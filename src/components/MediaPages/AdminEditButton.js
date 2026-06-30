'use client'

import Link from 'next/link'
import { authClient } from '@src/lib/auth-client'

/**
 * Admin-only "Edit in Admin" button shown on media detail pages.
 *
 * These detail pages render inside `'use cache'` server subtrees, so visibility
 * must NOT be decided on the server — that would bake one user's admin state
 * into the shared cache entry. Instead this is a client component: the cached
 * HTML is identical for everyone, and the session/role check runs client-side
 * after hydration, rendering the link only for admins.
 *
 * @param {Object} props
 * @param {string} props.href - Admin editor URL (e.g. `/admin/media/movies/<id>`).
 * @param {string} [props.label] - Visible button label.
 */
export default function AdminEditButton({ href, label = 'Edit in Admin' }) {
  const { data: session } = authClient.useSession()

  if (!href || session?.user?.role !== 'admin') return null

  return (
    <Link href={href} className="self-center" prefetch={false}>
      <button
        type="button"
        className="flex flex-row gap-x-2 rounded bg-amber-600 px-2 py-1 text-base font-semibold text-white shadow-sm hover:bg-amber-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="w-6 h-6"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
          />
        </svg>
        {label}
      </button>
    </Link>
  )
}
