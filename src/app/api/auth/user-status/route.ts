// src/app/api/auth/user-status/route.ts
// Validates a bearer token (device auth access_token or session token) and returns user info.
// Used by TV/mobile native apps to verify their stored token is still valid.
import { NextResponse } from 'next/server'
import type { User } from '@src/lib/auth'
import { getSession } from '@src/lib/cachedAuth'

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { authenticated: false, error: 'Authentication token is required', sessionExpired: true },
        { status: 401 }
      )
    }

    // The bearer plugin makes auth.api.getSession() read Authorization: Bearer automatically.
    // This covers both device auth tokens (from /device/token) and regular session tokens.
    const session = await getSession();


    if (!session?.user) {
      return NextResponse.json(
        { authenticated: false, error: 'Invalid or expired token', sessionExpired: true },
        { status: 401 }
      )
    }

    const user = session.user as User
    return NextResponse.json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        approved: user.approved,
        limitedAccess: user.limitedAccess,
        role: user.role,
      },
    })
  } catch (error) {
    console.error('Error checking user status:', error)
    return NextResponse.json(
      { authenticated: false, error: 'Failed to check authentication status' },
      { status: 500 }
    )
  }
}
