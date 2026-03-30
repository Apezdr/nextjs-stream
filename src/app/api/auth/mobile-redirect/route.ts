// src/app/api/auth/mobile-redirect/route.ts
// Bridges an authenticated web session to the native TV app via deep link.
// The TV app receives the session token and uses it as Authorization: Bearer going forward.
import { NextResponse } from 'next/server'
import { getSession } from '@src/lib/cachedAuth';

export async function GET() {
  const session = await getSession();

  if (!session?.user || !session.session?.token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // session.session.token is the better-auth session token.
  // The bearer plugin validates this token when the TV sends Authorization: Bearer <token>.
  return NextResponse.redirect(
    `routertv://redirect?token=${session.session.token}`,
    307
  )
}
