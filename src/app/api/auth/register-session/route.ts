// src/app/api/auth/register-session/route.ts
import { NextResponse } from 'next/server';
import { createAuthSession } from '@src/lib/auth';

export async function POST(req: Request) {
  try {
    const { clientId } = await req.json();
    
    if (!clientId) {
      return NextResponse.json({ error: 'Client ID is required' }, { status: 400 });
    }
    
    const session = await createAuthSession(clientId);
    
    return NextResponse.json({
      sessionId: session.sessionId,
      expiresAt: session.expiresAt.getTime()
    });
  } catch (error) {
    console.error('Error creating auth session:', error);
    return NextResponse.json(
      { error: 'Failed to create authentication session' },
      { status: 500 }
    );
  }
}
