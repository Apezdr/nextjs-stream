// src/app/api/auth/register-qr-session/route.ts
import { NextResponse } from 'next/server';
import { createQRAuthSession } from '@src/lib/auth';
import { nanoid } from 'nanoid';

export async function POST(req: Request) {
  try {
    const { clientId, deviceType, host, deviceInfo } = await req.json();
    
    if (!clientId) {
      return NextResponse.json({ error: 'Client ID is required' }, { status: 400 });
    }
    
    if (!deviceType) {
      return NextResponse.json({ error: 'Device type is required' }, { status: 400 });
    }
    
    // Validate device type
    if (!['tv', 'mobile', 'tablet', 'desktop'].includes(deviceType)) {
      return NextResponse.json({ error: 'Invalid device type' }, { status: 400 });
    }
    
    // Validate deviceInfo if provided
    if (deviceInfo && (!deviceInfo.brand || !deviceInfo.model || !deviceInfo.platform)) {
      return NextResponse.json({ error: 'Invalid device info structure' }, { status: 400 });
    }
    
    const session = await createQRAuthSession(clientId, deviceType, host, deviceInfo);
    
    // Generate QR data that the TV app will encode into a QR code
    const qrData = {
      qrSessionId: session.qrSessionId,
      host: host || req.headers.get('host') || 'localhost:3232',
      deviceType: session.deviceType
    };
    
    return NextResponse.json({
      qrSessionId: session.qrSessionId,
      expiresAt: session.expiresAt.getTime(),
      qrData
    });
  } catch (error) {
    console.error('Error creating QR auth session:', error);
    return NextResponse.json(
      { error: 'Failed to create QR authentication session' },
      { status: 500 }
    );
  }
}