'use server'

import { requireAdminAction } from '@src/utils/routeAuth'
import { RoleInputError } from '@src/lib/roles/capability'
import { deleteRole, saveRole, setUserRoles } from '@src/lib/roles/store'

// Admin-only, like every action here: each is its own POST endpoint, so each
// checks its caller. A refusal the admin can fix comes back as { ok: false,
// error }; anything else throws.
async function outcome(work) {
  try {
    return { ok: true, ...(await work()) }
  } catch (error) {
    if (error instanceof RoleInputError) return { ok: false, error: error.message }
    throw error
  }
}

export async function saveRoleAction(input) {
  await requireAdminAction()
  return outcome(async () => ({ role: await saveRole(input) }))
}

export async function deleteRoleAction(roleId) {
  await requireAdminAction()
  return outcome(async () => {
    await deleteRole(roleId)
    return {}
  })
}

export async function setUserRolesAction({ userID, roleIds }) {
  await requireAdminAction()
  return outcome(async () => ({ roles: await setUserRoles(userID, roleIds) }))
}
