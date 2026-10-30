'use client'
import useSWR from 'swr'

export const CREDITS_AVAILABILITY_URL = '/api/authenticated/credits/availability'

async function fetchAvailability(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  // An error is not "no credits": SWR keeps the last answer it had.
  if (!response.ok) throw new Error(`credits availability: HTTP ${response.status}`)
  return response.json()
}

/**
 * Whether to show the "Credits & licenses" menu item (CREDITS_SIDECAR.md,
 * section 8). False until the first answer; after that, the last answer the
 * server gave, through any failed request.
 */
export function useCreditsAvailability() {
  const { data } = useSWR(CREDITS_AVAILABILITY_URL, fetchAvailability, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
    keepPreviousData: true,
  })
  return data?.available === true
}
