import { cache } from 'react'
import { auth } from '@src/lib/auth'
import { headers } from 'next/headers'

/**
 * Request-level cached auth function.
 * Deduplicates multiple getSession() calls within a single server request.
 * All RSC components should import this instead of calling auth.api.getSession() directly.
 */
export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() })
})
