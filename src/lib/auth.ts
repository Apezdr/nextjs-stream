// src/lib/auth.ts
import { betterAuth } from 'better-auth'
import { mongodbAdapter } from 'better-auth/adapters/mongodb'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { admin } from 'better-auth/plugins'
import { bearer } from 'better-auth/plugins'
import { deviceAuthorization } from 'better-auth/plugins'
import { ObjectId } from 'mongodb'
import { mongoClient } from './mongodb'
import { getDefaultApprovalStatus } from '@src/utils/autoApproval'
import { userQueries } from './userQueries'
import { gatedAuthTrustedOrigins } from '@src/utils/gatedAuthOrigins'
import { USER_ADDITIONAL_FIELDS } from './authUserFields'
import { recordAuthHandlerCaller } from './requestCaller'
import {
  adminEmailsFromEnv,
  adminRoleUpdate,
  refusesNewUser,
  roleForNewUser,
  SOCIAL_SIGN_IN_PATHS,
  UNVERIFIED_ADMIN_EMAIL,
} from './adminRoleSync'
import { createLogger } from './logger'

const adminEmails = adminEmailsFromEnv()
const roleLog = createLogger('Auth.AdminRoles')

const authDb = mongoClient.db(process.env.MONGODB_AUTH_DB || 'Users')

export const auth = betterAuth({
  database: mongodbAdapter(authDb, { client: mongoClient, transaction: process.env.MONGODB_TRANSACTIONS === 'true' }),

  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,

  advanced: {
    database: {
      // Let MongoDB generate native ObjectId (optimal: 12 bytes vs 24 byte string)
      // Provides 50% smaller indexes and faster binary comparison
      generateId: false,
    },
    cookiePrefix: 'nextjs-stream',
    crossSubDomainCookies: {
      enabled: !!process.env.AUTH_COOKIE_DOMAIN,
      // better-auth expects the root domain WITHOUT a leading dot (e.g. "example.com")
      domain: process.env.AUTH_COOKIE_DOMAIN?.replace(/^\./, ''),
    },
  },

  // Allow all subdomains of AUTH_COOKIE_DOMAIN plus the explicit base URL.
  // When AUTH_COOKIE_DOMAIN is not set, only BETTER_AUTH_URL is trusted (single-domain).
  // Gated forward-auth origins are added so /auth/signin can hand the social flow a
  // callbackURL that lands back on the external app instead of being rejected.
  trustedOrigins: [
    ...(process.env.AUTH_COOKIE_DOMAIN
      ? [
          process.env.BETTER_AUTH_URL,
          // Wildcard covers every subdomain (app.example.com, api.example.com, …)
          `https://*.${process.env.AUTH_COOKIE_DOMAIN.replace(/^\./, '')}`,
        ]
      : [process.env.BETTER_AUTH_URL, process.env.NEXT_PUBLIC_BASE_URL]),
    ...gatedAuthTrustedOrigins,
  ].filter(Boolean) as string[],

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
    discord: {
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
    },
  },

  account: {
    accountLinking: {
      enabled: true,
      // No provider is trusted. A trusted provider links to an existing account
      // by email WITHOUT having verified the email: Discord reports `verified`
      // per account, and Google's email_verified claim can be false too, so an
      // unverified copy of someone's address (an admin's is on the privacy
      // page) would sign in as them. Untrusted, a provider still links when it
      // reports the email verified, and gets "account not linked" otherwise.
      trustedProviders: [],
    },
  },

  // Sign-in errors (account_not_linked, a refused sign-up) land on the app's
  // error page, which explains them, not better-auth's bare one
  onAPIError: {
    errorURL: '/auth/error',
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24,       // refresh daily
  },

  user: {
    // approved / limitedAccess are server-written only: see authUserFields.ts
    additionalFields: USER_ADDITIONAL_FIELDS,
  },

  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          // A listed address the provider didn't verify gets no account (adminRoleSync.ts)
          if (refusesNewUser(user, adminEmails)) {
            throw new APIError('FORBIDDEN', { message: UNVERIFIED_ADMIN_EMAIL })
          }
          const approved = getDefaultApprovalStatus()
          const role = roleForNewUser(user, adminEmails)
          // Admins are always approved
          return {
            data: {
              ...user,
              approved: role === 'admin' ? true : approved,
              limitedAccess: false,
              role,
            },
          }
        },
      },
    },
  },

  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      // These requests never pass through getSession(), so the hook names the caller
      recordAuthHandlerCaller(ctx.context as Parameters<typeof recordAuthHandlerCaller>[0])

      // Every social sign-in syncs the role with ADMIN_USER_EMAILS, both ways,
      // and approves an admin (adminRoleSync.ts). Written straight to the user:
      // the admin plugin's setRole needs an admin's session, which a sign-in
      // doesn't have. Every session lookup reads the role from the user
      // document (no cookie cache), so the change applies at once.
      if (!SOCIAL_SIGN_IN_PATHS.has(ctx.path)) return

      // The session the sign-in just made: ctx.context.session is null here
      const signedIn = (ctx.context as any)?.newSession?.user
      if (!signedIn?.id) return

      try {
        // Read again: newSession holds the user as loaded before the sign-in,
        // so on the sign-in that first verifies the address, emailVerified
        // there is still false
        const user = await userQueries.findById(signedIn.id, { email: 1, role: 1, approved: 1, emailVerified: 1 })
        if (!user) return
        const update = adminRoleUpdate(user, adminEmails)
        if (!update) return
        await userQueries.updateById(signedIn.id, update)
        // The user's id, never the email
        roleLog.info({ userId: String(signedIn.id), ...update }, 'Admin role synced with ADMIN_USER_EMAILS at sign-in')
      } catch (err) {
        roleLog.error({ userId: String(signedIn.id), error: (err as Error)?.message }, 'Admin role sync at sign-in failed')
      }
    }),
  },

  plugins: [
    admin({
      defaultRole: 'user',
      adminRole: 'admin',
    }),
    bearer(),
    deviceAuthorization({
      // TV/device clients poll /device/token; access_token = better-auth session.token
      // which the bearer plugin then validates transparently via auth.api.getSession()
      verificationUri: '/device',
      expiresIn: '30m',      // device code window; user must approve within this time
      interval: '5s',        // minimum TV polling interval
      userCodeLength: 8,     // user-friendly code length (8 chars, no hyphens)
    }),
  ],
})

export type Session = typeof auth.$Infer.Session
export type User = typeof auth.$Infer.Session.user
