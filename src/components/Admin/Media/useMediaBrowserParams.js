'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'

/**
 * URL-param writer shared by the media browser's toolbar and table headers.
 *
 * Filters, sort and paging all live in the URL so the RSC page re-runs the
 * MongoDB query — there is no client-side data fetching here. Keeping one
 * writer means a header click and a toolbar change cannot disagree about how a
 * param is cleared.
 */
export default function useMediaBrowserParams() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  function pushParams(next) {
    const params = new URLSearchParams(searchParams.toString())

    for (const [key, value] of Object.entries(next)) {
      // page is the only numeric param with a meaningful default (1).
      if (key === 'page') {
        if (Number(value) > 1) params.set('page', String(value))
        else params.delete('page')
        continue
      }
      if (key === 'sort') {
        if (value && value !== 'title') params.set('sort', value)
        else params.delete('sort')
        continue
      }
      if (value) params.set(key, String(value))
      else params.delete(key)
    }

    const query = params.toString()
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname))
  }

  return { pushParams, isPending, pathname }
}
