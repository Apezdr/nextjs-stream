'use server'

import { userQueries } from '@src/lib/userQueries'
import { adminGate } from '@src/lib/roles/gates'

export async function updateUserLimitedAccessFlag({ limitedAccess = false, userID }) {
  await adminGate.action()
  if (userID) {
    const users = await userQueries.updateById(userID, { limitedAccess })
    return users
  }
  return false
}

export async function updateUserApprovedFlag({ approved = false, userID }) {
  await adminGate.action()
  if (userID) {
    const users = await userQueries.updateById(userID, { approved })
    return users
  }
  return false
}
