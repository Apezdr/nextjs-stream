// src/lib/auth.ts
import NextAuth, { Session, User } from 'next-auth'
import authConfig from './auth.config'
import clientPromise from './mongodb'
import MongoDBCustomAdapter from './MongoDBCustomAdapter'
import { JWT } from '@auth/core/jwt'
import { adminUserEmails } from '@src/utils/config'
import { SignJWT, jwtVerify } from 'jose'
import { nanoid } from 'nanoid'
import { ObjectId } from 'mongodb'

// Types for auth sessions (both regular tokenized auth and QR auth)
// Status flow: pending -> authenticating -> complete/failed -> expired (via TTL)
// - pending: Session created, waiting for user action (scan QR code or initiate token auth)
// - authenticating: User has started OAuth flow (redirecting to provider like Google/Discord for token auth)
// - complete: Authentication successful, tokens stored and ready for client consumption
// - failed: Authentication failed (user denied access, provider error, or other failure)
// - expired: Session expired (handled automatically by MongoDB TTL indexes)
export type AuthSessionStatus = 'pending' | 'authenticating' | 'complete' | 'failed' | 'expired'

export interface AuthSession {
  sessionId: string
  clientId: string
  status: AuthSessionStatus
  createdAt: Date
  expiresAt: Date
  tokens?: {
    user: CustomUser
    mobileSessionToken: string
    sessionId: string
  }
}

// Device information interface
export interface DeviceInfo {
  brand: string
  model: string
  platform: string
}

// Extended interface for QR authentication sessions
export interface QRAuthSession extends AuthSession {
  qrSessionId: string
  deviceType: 'tv' | 'mobile' | 'tablet' | 'desktop'
  host?: string
  isQRAuth: boolean
  provider?: string
  error?: string
  deviceInfo?: DeviceInfo
}

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
    Users: 'AuthenticatedUsers',
    Accounts: 'SSOAccounts',
    Sessions: 'session',
    VerificationTokens: 'verificationTokens',
  },
  databaseName: 'Users',
}

// JWT secret for mobile tokens (different from NextAuth secret)
const MOBILE_JWT_SECRET = new TextEncoder().encode(
  process.env.MOBILE_JWT_SECRET || process.env.NEXTAUTH_SECRET || 'fallback-secret'
)

// Generate a one-time token for mobile app authentication
export async function generateMobileToken(userId: string, sessionId: string) {
  const payload = {
    userId,
    sessionId,
    type: 'mobile-auth',
    jti: nanoid(), // unique token ID
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24), // 24 hours expiry (for uninterrupted streaming)
  }

  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .sign(MOBILE_JWT_SECRET)
}

// Verify and consume a one-time mobile token
export async function verifyMobileToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, MOBILE_JWT_SECRET)
    
    if (payload.type !== 'mobile-auth') {
      throw new Error('Invalid token type')
    }

    // Check if token has been used (store used tokens in DB for security)
    const client = await clientPromise
    const usedToken = await client
      .db('Users')
      .collection('usedTokens')
      .findOne({ jti: payload.jti })

    if (usedToken) {
      throw new Error('Token already used')
    }

    // Mark token as used
    await client
      .db('Users')
      .collection('usedTokens')
      .insertOne({ 
        jti: payload.jti, 
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // cleanup after 24h
      })

    return payload
  } catch (error) {
    throw new Error('Invalid or expired token')
  }
}

// Create a new authentication session for mobile/TV auth flow
export async function createAuthSession(clientId: string): Promise<AuthSession> {
  const client = await clientPromise
  
  // Generate a unique session ID
  const sessionId = nanoid(24)
  
  // Set expiration time (30 minutes from now)
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000)
  
  const session: AuthSession = {
    sessionId,
    clientId,
    status: 'pending',
    createdAt: new Date(),
    expiresAt
  }
  
  // Store the session in MongoDB
  await client
    .db('Users')
    .collection('authSessions')
    .insertOne(session)
  
  return session
}

// Get an authentication session by session ID
export async function getAuthSession(sessionId: string): Promise<AuthSession | null> {
  const client = await clientPromise
  
  const session = await client
    .db('Users')
    .collection('authSessions')
    .findOne({ sessionId })
  
  return session as AuthSession | null
}

// Store tokens with session ID after successful authentication
export async function storeSessionTokens(
  sessionId: string,
  tokens: { user: CustomUser; mobileSessionToken: string; sessionId: string }
): Promise<void> {
  const client = await clientPromise
  
  await client
    .db('Users')
    .collection('authSessions')
    .updateOne(
      { sessionId },
      {
        $set: {
          status: 'complete',
          tokens,
          updatedAt: new Date()
        }
      }
    )
}

// Create a new QR authentication session
export async function createQRAuthSession(
  clientId: string,
  deviceType: 'tv' | 'mobile' | 'tablet' | 'desktop',
  host?: string,
  deviceInfo?: DeviceInfo
): Promise<QRAuthSession> {
  const client = await clientPromise
  
  // Generate unique session IDs
  const sessionId = nanoid(24)
  const qrSessionId = nanoid(32) // Longer for QR sessions
  
  // Set expiration time (30 minutes for QR sessions - aligned with provider auth)
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000)
  
  const session: QRAuthSession = {
    sessionId,
    qrSessionId,
    clientId,
    deviceType,
    host,
    status: 'pending',
    createdAt: new Date(),
    expiresAt,
    isQRAuth: true,
    deviceInfo
  }
  
  // Store the QR session in MongoDB
  await client
    .db('Users')
    .collection('authSessions')
    .insertOne(session)
  
  // TTL index removed - using manual expiry checks for consistency with direct sessions
  
  return session
}

// Get a QR authentication session by QR session ID
export async function getQRAuthSession(qrSessionId: string): Promise<QRAuthSession | null> {
  const client = await clientPromise
  
  const session = await client
    .db('Users')
    .collection('authSessions')
    .findOne({ qrSessionId, isQRAuth: true })
  
  return session as QRAuthSession | null
}

// Store tokens with QR session ID after successful authentication
export async function storeQRSessionTokens(
  qrSessionId: string,
  tokens: { user: CustomUser; mobileSessionToken: string; sessionId: string }
): Promise<void> {
  const client = await clientPromise
  
  await client
    .db('Users')
    .collection('authSessions')
    .updateOne(
      { qrSessionId, isQRAuth: true },
      {
        $set: {
          status: 'complete',
          tokens,
          updatedAt: new Date()
        }
      }
    )
}

// Mark QR session as failed with error message
export async function markQRSessionFailed(
  qrSessionId: string,
  error: string
): Promise<void> {
  const client = await clientPromise
  
  await client
    .db('Users')
    .collection('authSessions')
    .updateOne(
      { qrSessionId, isQRAuth: true },
      {
        $set: {
          status: 'failed',
          error,
          updatedAt: new Date()
        }
      }
    )
}

// Update QR session status (for tracking authentication progress)
export async function updateQRSessionStatus(
  qrSessionId: string,
  status: AuthSessionStatus,
  provider?: string
): Promise<void> {
  const client = await clientPromise
  
  const updateData: any = {
    status,
    updatedAt: new Date()
  }
  
  if (provider) {
    updateData.provider = provider
  }
  
  await client
    .db('Users')
    .collection('authSessions')
    .updateOne(
      { qrSessionId, isQRAuth: true },
      { $set: updateData }
    )
}

// TTL index function removed - using manual expiry checks for consistency
// This ensures both QR and direct sessions have identical behavior
//
// Previously this function created a TTL index that only applied to QR sessions,
// causing inconsistent behavior where QR sessions were hard-deleted by MongoDB
// while direct sessions used soft expiry checks in application code.
//
// async function ensureQRSessionTTLIndex(): Promise<void> {
//   const client = await clientPromise
//   const collection = client.db('Users').collection('authSessions')
//
//   try {
//     await collection.createIndex(
//       { expiresAt: 1 },
//       {
//         expireAfterSeconds: 0,
//         name: 'qr_session_ttl_index',
//         partialFilterExpression: { isQRAuth: true }
//       }
//     )
//   } catch (error) {
//     if (error.code !== 85) {
//       console.error('Error creating QR session TTL index:', error)
//     }
//   }
// }

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
    // Used primarily for allowing mobile application to redirect to the app after authentication
    async redirect({ url, baseUrl }) {
      // Check if this is a session-based auth flow
      const urlObj = new URL(url, baseUrl);
      const sessionId = urlObj.searchParams.get('sessionId');
      const qrSessionId = urlObj.searchParams.get('qrSessionId');
      
      // If this is a session-based auth and we're at the callback
      if (sessionId) {
        // Instead of redirecting to the app, go to the auth-complete page
        return `${baseUrl}/auth-complete?sessionId=${sessionId}`;
      }
      
      // If this is a QR session-based auth and we're at the callback
      if (qrSessionId) {
        // Instead of redirecting to the app, go to the auth-complete page
        return `${baseUrl}/auth-complete?qrSessionId=${qrSessionId}`;
      }
      
      // If we're already handling a deep-link, just pass it through
      if (url.startsWith('routertv://')) {
        return url;
      }

      // Otherwise (web flows) keep the normal behaviour:
      if (url.startsWith('/')) return `${baseUrl}${url}`;
      if (new URL(url).origin === baseUrl) return url;
      return baseUrl;
    },
  },
  events: {
    async signIn({ user, account, isNewUser }) {
      // Handle session-based authentication
      // We'll check if there's a pending auth session to update
      // This is done in a middleware or in the mobile-redirect route
    }
  },
  ...authConfig,
})

// Helper function to get user data by session ID (for real-time updates)
export async function getUserBySessionId(sessionId: string) {
  const client = await clientPromise
  const sessionIdObjectId = new ObjectId(sessionId)
  const session = await client
    .db('Users')
    .collection('session')
    .findOne({ _id: sessionIdObjectId })
  
  if (!session) return null

  const user = await client
    .db('Users')
    .collection('AuthenticatedUsers')
    .findOne({ _id: session.userId })

  if (!user) return null

  const isAdmin = adminUserEmails.includes(user.email)
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    image: user.image,
    approved: isAdmin ? true : user.approved,
    limitedAccess: user.limitedAccess,
    admin: isAdmin,
  } as CustomUser
}

// Helper function to get user data by mobile token
export async function getUserByMobileToken(mobileToken: string): Promise<CustomUser | null> {
  try {
    const client = await clientPromise
    
    // Find the auth session that contains this mobile token
    const authSession = await client
      .db('Users')
      .collection('authSessions')
      .findOne({ 
        'tokens.mobileSessionToken': mobileToken,
        status: 'complete'
      })
    
    if (!authSession || !authSession.tokens?.user?.id) {
      return null
    }
    
    // Get the fresh user data from AuthenticatedUsers (single source of truth)
    const userObjectId = new ObjectId(authSession.tokens.user.id)
    const user = await client
      .db('Users')
      .collection('AuthenticatedUsers')
      .findOne({ _id: userObjectId })

    if (!user) return null

    const isAdmin = adminUserEmails.includes(user.email)
    return {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      image: user.image,
      approved: isAdmin ? true : user.approved,
      limitedAccess: user.limitedAccess,
      admin: isAdmin,
    } as CustomUser
  } catch (error) {
    console.error('Error fetching user by mobile token:', error)
    return null
  }
}
