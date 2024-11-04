import NextAuth, { Session, User } from 'next-auth'
import authConfig from './auth.config'
//import { MongoDBAdapter } from '@auth/mongodb-adapter'
import clientPromise from './mongodb'
import MongoDBCustomAdapter from './MongoDBCustomAdapter'
import { JWT } from '@auth/core/jwt'
import { adminUserEmails } from '@src/utils/config'

type CustomUser = {
  id: string
  email: string
  name?: string
  image?: string
  approved: boolean
  limitedAccess?: boolean
  admin?: boolean
}

const myMongoDBAdapterOptions = {
  collections: {
    Users: 'AuthenticatedUsers', // Custom collection name for users
    Accounts: 'SSOAccounts', // Custom collection name for accounts
    Sessions: 'session', // Custom collection name for sessions
    VerificationTokens: 'verificationTokens', // Custom collection name for verification tokens
  },
  databaseName: 'Users', // Custom database name
}

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
}: {
  handlers: { GET: any; POST: any }
  auth: any
  signIn: any
  signOut: any
} = NextAuth({
  session: { strategy: 'database' },
  adapter: MongoDBCustomAdapter(clientPromise, myMongoDBAdapterOptions),
  callbacks: {
    async session({ session, user }: { session: Session; user?: User; token?: JWT }) {
      const client = await clientPromise
      const existingUser = await client
        .db('Users')
        .collection('AuthenticatedUsers')
        .findOne({ email: session.user ? session.user.email : user?.email })
      if (existingUser) {
        if (session.user) {
          const isAdmin = adminUserEmails.includes(existingUser.email)
          session.user = {
            ...session.user,
            id: existingUser._id.toString() as string,
            approved: isAdmin ? true : (existingUser.approved as boolean), // Add the 'approved' flag to the session's user object
            limitedAccess: existingUser.limitedAccess as boolean, // Add the 'limitedAccess' flag to the session's user object; used to restrict access to content
          } as CustomUser
          if (isAdmin) {
            session.user = {
              ...session.user,
              admin: true,
            } as CustomUser
          }
        }
      }
      // If the user signed in without an adapter being used, the user will be redirected to the sign in page
      if (!existingUser) {
        throw new Error('User not found in the database') // Invalidate the session
      }
      return session // Return the session if the user exists
    },
  },
  ...authConfig,
})
