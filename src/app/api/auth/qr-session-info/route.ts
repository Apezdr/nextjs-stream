// src/app/api/auth/qr-session-info/route.ts
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
      return NextResponse.json({ error: 'QR session not found or expired' }, { status: 404 });
    }
    
    // Return session info for mobile app to display
    return NextResponse.json({
      qrSessionId: session.qrSessionId,
      clientId: session.clientId,
      deviceType: session.deviceType,
      status: session.status,
      expiresAt: session.expiresAt.getTime(),
      createdAt: session.createdAt.getTime()
    });
  } catch (error) {
    console.error('Error fetching QR session info:', error);
    return NextResponse.json(
      { error: 'Failed to fetch QR session information' },
      { status: 500 }
    );
  }
}