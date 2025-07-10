// src/app/api/auth/check-qr-token/route.ts
import { NextResponse } from 'next/server';
import { getQRAuthSession } from '@src/lib/auth';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const qrSessionId = searchParams.get('qrSessionId');
    
    if (!qrSessionId) {
      return NextResponse.json({ error: 'QR session ID is required' }, { status: 400 });
    }
    
    const session = await getQRAuthSession(qrSessionId);
    
    if (!session) {
      return NextResponse.json({ error: 'QR session not found' }, { status: 404 });
    }
    
    // Manual expiry check for consistency with direct sessions
    if (session.expiresAt < new Date()) {
      return NextResponse.json({ status: 'expired' });
    }
    
    // Return current session status
    const response: any = {
      qrSessionId: session.qrSessionId,
      status: session.status,
      expiresAt: session.expiresAt.getTime()
    };
    
    // If authentication is complete, include tokens
    if (session.status === 'complete' && session.tokens) {
      response.tokens = {
        mobileSessionToken: session.tokens.mobileSessionToken,
        sessionId: session.tokens.sessionId,
        user: session.tokens.user
      };
    }
    
    // If authentication failed, include error
    if (session.status === 'failed' && session.error) {
      response.error = session.error;
    }
    
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error checking QR token:', error);
    return NextResponse.json(
      { error: 'Failed to check QR authentication status' },
      { status: 500 }
    );
  }
}