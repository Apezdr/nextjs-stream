// src/lib/auth-client.ts
import { createAuthClient } from 'better-auth/react'
import { adminClient } from 'better-auth/client/plugins'
import { deviceAuthorizationClient } from 'better-auth/client/plugins'
import { inferAdditionalFields } from 'better-auth/client/plugins'
import type { auth } from './auth'

export const authClient = createAuthClient({
  plugins: [
    adminClient(),
    deviceAuthorizationClient(),
    inferAdditionalFields<typeof auth>(),
  ],
})

export type Session = typeof authClient.$Infer.Session
