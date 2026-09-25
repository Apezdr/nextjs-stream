'use server'

import { userQueries } from '@src/lib/userQueries'
import { requireAdminAction } from '@src/utils/routeAuth'

export async function updateUserLimitedAccessFlag({ limitedAccess = false, userID }) {
  await requireAdminAction()
  if (userID) {
    const users = await userQueries.updateById(userID, { limitedAccess })
    return users
  }
  return false
}

export async function updateUserApprovedFlag({ approved = false, userID }) {
  await requireAdminAction()
  if (userID) {
    const users = await userQueries.updateById(userID, { approved })
    return users
  }
  return false
}
