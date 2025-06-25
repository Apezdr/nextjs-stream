// src/app/api/auth/check-token/route.ts
import { NextResponse } from 'next/server';
import { getAuthSession } from '@src/lib/auth';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get('sessionId');
    
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID is required' }, { status: 400 });
    }
    
    const session = await getAuthSession(sessionId);
    
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    
    if (session.expiresAt < new Date()) {
      return NextResponse.json({ status: 'expired' });
    }
    
    if (session.status === 'complete' && session.tokens) {
      return NextResponse.json({
        status: 'complete',
        tokens: session.tokens
      });
    }
    
    return NextResponse.json({ status: 'pending' });
  } catch (error) {
    console.error('Error checking token status:', error);
    return NextResponse.json(
      { error: 'Failed to check authentication status' },
      { status: 500 }
    );
  }
}
