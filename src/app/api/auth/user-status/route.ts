// src/app/api/auth/user-status/route.ts
import { NextResponse } from 'next/server';
import { getUserByMobileToken } from '@src/lib/auth';

export async function GET(req: Request) {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.get('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { 
          authenticated: false,
          error: 'Authentication token is required',
          sessionExpired: true
        }, 
        { status: 401 }
      );
    }
    
    const token = authHeader.split(' ')[1];
    
    // Get the user details using the mobile token
    try {
      const user = await getUserByMobileToken(token);
      
      if (!user) {
        return NextResponse.json(
          { 
            authenticated: false,
            error: 'User not found or token invalid',
            sessionExpired: true
          }, 
          { status: 401 }
        );
      }
      
      // Return user status and information
      return NextResponse.json({
        authenticated: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          approved: user.approved,
          limitedAccess: user.limitedAccess,
          admin: user.admin
        }
      });
    } catch (error) {
      console.error('Token verification failed:', error);
      return NextResponse.json(
        { 
          authenticated: false,
          error: 'Invalid or expired authentication token',
          sessionExpired: true
        }, 
        { status: 401 }
      );
    }
  } catch (error) {
    console.error('Error checking user status:', error);
    return NextResponse.json(
      { 
        authenticated: false,
        error: 'Failed to check authentication status'
      },
      { status: 500 }
    );
  }
}
