// src/app/api/auth/approve-qr-session/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@src/lib/auth';
import { getQRAuthSession, storeQRSessionTokens, generateMobileToken } from '@src/lib/auth';

export async function POST(req: Request) {
  try {
    const { qrSessionId } = await req.json();
    
    if (!qrSessionId) {
      return NextResponse.json({ error: 'QR session ID is required' }, { status: 400 });
    }
    
    // Check if user is authenticated
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 });
    }
    
    // Get the QR session
    const qrSession = await getQRAuthSession(qrSessionId);
    if (!qrSession) {
      return NextResponse.json({ error: 'QR session not found or expired' }, { status: 404 });
    }
    
    if (qrSession.status !== 'pending') {
      return NextResponse.json({ error: 'QR session is not in pending state' }, { status: 400 });
    }
    
    // Generate mobile token for the authenticated user
    const mobileSessionToken = await generateMobileToken(
      session.user.id,
      session.user.id
    );
    
    // Store tokens in the QR session
    await storeQRSessionTokens(qrSessionId, {
      user: {
        id: session.user.id,
        email: session.user.email || '',
        name: session.user.name || '',
        image: session.user.image || '',
        approved: (session.user as any).approved || false,
        limitedAccess: (session.user as any).limitedAccess || false,
        admin: (session.user as any).admin || false,
      },
      mobileSessionToken,
      sessionId: qrSessionId,
    });
    
    return NextResponse.json({
      success: true,
      message: 'TV sign-in approved successfully'
    });
  } catch (error) {
    console.error('Error approving QR session:', error);
    return NextResponse.json(
      { error: 'Failed to approve QR session' },
      { status: 500 }
    );
  }
}