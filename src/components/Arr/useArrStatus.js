'use client'

import { useMemo } from 'react'
import useSWR from 'swr'
import { arrStatusUrl, fetchJson } from './arrApi'

/** While anything is downloading, often enough for the progress to move. */
const DOWNLOADING_REFRESH_MS = 15_000
const IDLE_REFRESH_MS = 120_000

/**
 * Radarr/Sonarr state for a page of watchlist items, for the admin chips. One
 * request per page, kept apart from the list itself so a slow Radarr never
 * holds the watchlist up. `enabled` false (not an admin) asks nothing.
 */
export default function useArrStatus(items, enabled) {
  const url = useMemo(() => (enabled ? arrStatusUrl(items) : null), [items, enabled])
  const { data, mutate } = useSWR(url, fetchJson, {
    refreshInterval: (latest) =>
      Object.values(latest?.items ?? {}).some((status) => status.state === 'downloading')
        ? DOWNLOADING_REFRESH_MS
        : IDLE_REFRESH_MS,
    revalidateOnFocus: false,
    keepPreviousData: true,
    // A chip is extra detail: a failed check waits for the next interval.
    shouldRetryOnError: false,
  })
  return { statuses: data?.items ?? null, services: data?.services ?? null, refresh: mutate }
}
