// src/app/api/auth/refresh-token/route.ts
// TV/mobile clients can call this to get fresh user data when their token is still valid.
// Sessions auto-refresh via better-auth; this endpoint just returns the current user state.
import { NextResponse } from 'next/server'
import type { User } from '@src/lib/auth'
import { getSession } from '@src/lib/cachedAuth';

export async function POST(req: Request) {
  try {
    const session = await getSession();

    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired token' },
        { status: 401 }
      )
    }

    const user = session.user as User
    return NextResponse.json({
      success: true,
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
    console.error('Error refreshing token:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to refresh token' },
      { status: 500 }
    )
  }
}
