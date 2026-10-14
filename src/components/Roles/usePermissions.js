'use client'

import useSWR from 'swr'

/** Only an admin or a user holding a role can have any capability: nobody else needs to ask. */
export const mayHoldGrants = (user) =>
  user?.role === 'admin' || (Array.isArray(user?.roles) && user.roles.length > 0)

async function fetchPermissions(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Permissions request failed (HTTP ${response.status})`)
  return response.json()
}

/**
 * The signed-in user's capabilities ({ admin, grants }, src/lib/roles), or
 * null until known and for anyone who holds none. For deciding what to
 * offer: the server checks every action again. One request, shared by every
 * component that asks.
 */
export default function usePermissions(user) {
  const { data } = useSWR(mayHoldGrants(user) ? '/api/authenticated/permissions' : null, fetchPermissions, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
    shouldRetryOnError: false,
  })
  return data ?? null
}
