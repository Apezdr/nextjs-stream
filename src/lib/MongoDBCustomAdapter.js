import { MongoDBAdapter } from '@auth/mongodb-adapter'

export default function MongoDBCustomAdapter(clientPromise, options) {
  const adapter = MongoDBAdapter(clientPromise, options)

  return {
    ...adapter,
    async createUser(user) {
      // Add the approved field with a default value of false & limitedAccess with a default value of false
      const modifiedUser = { ...user, approved: false, limitedAccess: false }
      return adapter.createUser(modifiedUser)
    },
    // ... other methods
  }
}
