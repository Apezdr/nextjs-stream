// src/app/api/auth/refresh-token/route.ts
import { NextResponse } from 'next/server';
import { getAuthSession, getQRAuthSession, generateMobileToken, storeSessionTokens, storeQRSessionTokens } from '@src/lib/auth';
import clientPromise from '@src/lib/mongodb';
import { ObjectId } from 'mongodb';
import { adminUserEmails } from '@src/utils/config';

interface RefreshTokenRequest {
  clientId: string;
  sessionId: string;
}

interface RefreshTokenResponse {
  success: boolean;
  mobileSessionToken?: string;
  user?: any;
  error?: string;
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as RefreshTokenRequest;
    const { clientId, sessionId } = body;
    
    // Get session ID from header as backup
    const headerSessionId = req.headers.get('x-session-id');
    const actualSessionId = sessionId || headerSessionId;
    
    if (!actualSessionId) {
      return NextResponse.json({ 
        success: false, 
        error: 'Session ID is required' 
      } as RefreshTokenResponse, { status: 400 });
    }
    
    if (!clientId) {
      return NextResponse.json({ 
        success: false, 
        error: 'Client ID is required' 
      } as RefreshTokenResponse, { status: 400 });
    }
    
    // Try to find the session - check both regular and QR sessions
    let authSession = await getAuthSession(actualSessionId);
    let isQRSession = false;
    
    // If not found as regular session, try as QR session
    if (!authSession) {
      authSession = await getQRAuthSession(actualSessionId);
      isQRSession = true;
    }
    
    if (!authSession) {
      return NextResponse.json({ 
        success: false, 
        error: 'Session not found' 
      } as RefreshTokenResponse, { status: 404 });
    }
    
    // Check if session has expired
    if (authSession.expiresAt < new Date()) {
      return NextResponse.json({ 
        success: false, 
        error: 'Session expired' 
      } as RefreshTokenResponse, { status: 401 });
    }
    
    // Check if session is complete and has tokens
    if (authSession.status !== 'complete' || !authSession.tokens) {
      return NextResponse.json({ 
        success: false, 
        error: 'Session not authenticated' 
      } as RefreshTokenResponse, { status: 401 });
    }
    
    // Verify client ID matches
    if (authSession.clientId !== clientId) {
      return NextResponse.json({ 
        success: false, 
        error: 'Invalid client ID' 
      } as RefreshTokenResponse, { status: 403 });
    }
    
    // Get fresh user data from the database using the user ID from the existing tokens
    const existingUser = authSession.tokens.user;
    
    if (!existingUser || !existingUser.id) {
      return NextResponse.json({
        success: false,
        error: 'User data not found in session'
      } as RefreshTokenResponse, { status: 404 });
    }
    
    // Get fresh user data from AuthenticatedUsers collection
    const client = await clientPromise;
    const userObjectId = new ObjectId(existingUser.id);
    const freshUserData = await client
      .db('Users')
      .collection('AuthenticatedUsers')
      .findOne({ _id: userObjectId });
    
    if (!freshUserData) {
      return NextResponse.json({
        success: false,
        error: 'User not found in database'
      } as RefreshTokenResponse, { status: 404 });
    }
    
    // Build fresh user object with admin check
    const isAdmin = adminUserEmails.includes(freshUserData.email);
    const freshUser = {
      id: freshUserData._id.toString(),
      email: freshUserData.email,
      name: freshUserData.name,
      image: freshUserData.image,
      approved: isAdmin ? true : freshUserData.approved,
      limitedAccess: freshUserData.limitedAccess,
      admin: isAdmin,
    };
    
    // Generate a new mobile token using the user ID and auth session ID
    const newMobileToken = await generateMobileToken(
      freshUser.id,
      actualSessionId // Use the auth session ID, not the NextAuth session ID
    );
    
    // Update the session with new token, preserving the original sessionId structure
    const updatedTokenData = {
      user: freshUser,
      mobileSessionToken: newMobileToken,
      sessionId: authSession.tokens.sessionId // Keep the original sessionId from the stored tokens
    };
    
    // Store the updated tokens based on session type
    if (isQRSession) {
      await storeQRSessionTokens(actualSessionId, updatedTokenData);
    } else {
      await storeSessionTokens(actualSessionId, updatedTokenData);
    }
    
    return NextResponse.json({
      success: true,
      mobileSessionToken: newMobileToken,
      user: freshUser
    } as RefreshTokenResponse);
    
  } catch (error) {
    console.error('Error refreshing token:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to refresh token' 
      } as RefreshTokenResponse,
      { status: 500 }
    );
  }
}