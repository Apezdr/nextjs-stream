// app/api/auth/mobile-redirect/route.ts
import { NextResponse } from 'next/server'
import { auth, generateMobileToken } from '@src/lib/auth'

export async function GET(req: Request) {
  // 1️⃣ Fetch the NextAuth session (reads the cookie for you)
  const session = await auth()
  if (!session || !session.user) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    )
  }

  // 2️⃣ Mint a one-time mobile token for this user/session
  //    You can use session.user.id and/or any other session info
  if (!session.user.id) {
    return NextResponse.json(
      { error: 'User ID not found in session' },
      { status: 500 }
    )
  }
  const mobileToken = await generateMobileToken(
    session.user.id,
    session.user.id  // or a real session ID if you have it
  )

  // 3️⃣ Redirect straight into your deep-link handler
  return NextResponse.redirect(
    `routertv://redirect?token=${mobileToken}`,
    307
  )
}
