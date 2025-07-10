// src/app/api/auth/authenticate-qr-session/route.ts
import { NextResponse } from 'next/server';
import { getQRAuthSession } from '@src/lib/auth';
import clientPromise from '@src/lib/mongodb'

export async function POST(req: Request) {
  try {
    const { qrSessionId, provider } = await req.json();
    
    if (!qrSessionId) {
      return NextResponse.json({ error: 'QR session ID is required' }, { status: 400 });
    }
    
    if (!provider) {
      return NextResponse.json({ error: 'Authentication provider is required' }, { status: 400 });
    }
    
    // Validate provider
    if (!['google', 'discord'].includes(provider)) {
      return NextResponse.json({ error: 'Invalid authentication provider' }, { status: 400 });
    }
    
    const session = await getQRAuthSession(qrSessionId);
    
    if (!session) {
      return NextResponse.json({ error: 'QR session not found or expired' }, { status: 404 });
    }
    
    if (session.status !== 'pending') {
      return NextResponse.json({ error: 'QR session is not in pending state' }, { status: 400 });
    }
    
    // Update session status to authenticating
    const client = await clientPromise;
    const db = client.db('Users');
    await db.collection('authSessions').updateOne(
      { qrSessionId },
      { 
        $set: { 
          status: 'authenticating',
          provider,
          updatedAt: new Date()
        }
      }
    );
    
    // Generate OAuth URL for the mobile device
    const baseUrl = req.headers.get('host') || 'localhost:3232';
    const protocol = req.headers.get('x-forwarded-proto') || 'http';
    const authUrl = `${protocol}://${baseUrl}/native-signin/${provider}?qrSessionId=${qrSessionId}`;
    
    return NextResponse.json({
      authUrl,
      qrSessionId,
      provider,
      status: 'authenticating'
    });
  } catch (error) {
    console.error('Error initiating QR authentication:', error);
    return NextResponse.json(
      { error: 'Failed to initiate QR authentication' },
      { status: 500 }
    );
  }
}
