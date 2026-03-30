// src/lib/auth.ts
import { betterAuth } from 'better-auth'
import { mongodbAdapter } from 'better-auth/adapters/mongodb'
import { createAuthMiddleware } from 'better-auth/api'
import { admin } from 'better-auth/plugins'
import { bearer } from 'better-auth/plugins'
import { deviceAuthorization } from 'better-auth/plugins'
import { ObjectId } from 'mongodb'
import { mongoClient } from './mongodb'
import { getDefaultApprovalStatus } from '@src/utils/autoApproval'
import { userQueries } from './userQueries'

const adminEmails = (process.env.ADMIN_USER_EMAILS || '')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean)

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
  trustedOrigins: (
    process.env.AUTH_COOKIE_DOMAIN
      ? [
          process.env.BETTER_AUTH_URL,
          // Wildcard covers every subdomain (app.example.com, api.example.com, …)
          `https://*.${process.env.AUTH_COOKIE_DOMAIN.replace(/^\./, '')}`,
        ]
      : [process.env.BETTER_AUTH_URL, process.env.NEXT_PUBLIC_BASE_URL]
  ).filter(Boolean) as string[],

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
      // Trust both providers for automatic account linking on same email
      trustedProviders: ['google', 'discord'],
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24,       // refresh daily
  },

  user: {
    additionalFields: {
      approved: {
        type: 'boolean',
        required: false,
        defaultValue: false,
        input: true,
      },
      limitedAccess: {
        type: 'boolean',
        required: false,
        defaultValue: false,
        input: true,
      },
      // Stored as object in MongoDB (better-auth 'string' type allows flexible storage)
      // Migration keeps it as object - no JSON.parse/stringify needed in app code
      preferences: {
        type: 'string',
        required: false,
        input: true,
      },
    },
  },

  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const approved = getDefaultApprovalStatus()
          const role = adminEmails.includes(user.email) ? 'admin' : 'user'
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
      // Sync role from ADMIN_USER_EMAILS on every social sign-in.
      // Handles emails added/removed from the env var after account creation.
      if (ctx.path !== '/sign-in/social' && ctx.path !== '/callback/social') return

      const newSession = (ctx.context as any)?.newSession
      if (!newSession?.user?.email) return

      const email: string = newSession.user.email
      const shouldBeAdmin = adminEmails.includes(email)
      const isAdmin = newSession.user.role === 'admin'

      if (shouldBeAdmin !== isAdmin) {
        try {
          await (auth.api as any).setRole({
            body: {
              userId: newSession.user.id,
              role: shouldBeAdmin ? 'admin' : 'user',
            },
          })
        } catch (err) {
          console.error('Failed to sync admin role on sign-in:', err)
        }
      }

      // Ensure admins are always approved
      if (shouldBeAdmin && !newSession.user.approved) {
        try {
          await userQueries.updateById(newSession.user.id, { approved: true })
        } catch (err) {
          console.error('Failed to set admin approval on sign-in:', err)
        }
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
