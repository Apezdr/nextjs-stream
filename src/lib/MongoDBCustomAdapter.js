import { MongoDBAdapter } from '@auth/mongodb-adapter'
import { getDefaultApprovalStatus } from '@src/utils/autoApproval'

export default function MongoDBCustomAdapter(clientPromise, options) {
  const adapter = MongoDBAdapter(clientPromise, options)

  return {
    ...adapter,
    async createUser(user) {
      // Get the default approval status based on AUTO_APPROVE_USERS environment variable
      const defaultApprovalStatus = getDefaultApprovalStatus()

      // Add the approved field with a default value based on AUTO_APPROVE_USERS setting & limitedAccess with a default value of false
      const modifiedUser = { ...user, approved: defaultApprovalStatus, limitedAccess: false }
      return adapter.createUser(modifiedUser)
    },
    // ... other methods
  }
}
