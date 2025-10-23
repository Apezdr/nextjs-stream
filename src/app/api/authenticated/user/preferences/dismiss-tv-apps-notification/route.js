import { NextResponse } from 'next/server';
import { auth } from '@src/lib/auth';
import clientPromise from '@src/lib/mongodb';
import { ObjectId } from 'mongodb';

/**
 * POST /api/authenticated/user/preferences/dismiss-tv-apps-notification
 * Mark TV apps notification as dismissed for the current user
 */
export async function POST(request) {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const client = await clientPromise;
    const userId = new ObjectId(session.user.id);
    
    // Update user's preferences to mark TV apps notification as dismissed
    const result = await client
      .db('Users')
      .collection('AuthenticatedUsers')
      .updateOne(
        { _id: userId },
        {
          $set: {
            'preferences.tvAppsNotificationDismissed': true,
            'preferences.tvAppsNotificationDismissedAt': new Date()
          }
        },
        { upsert: false }
      );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ 
      success: true, 
      message: 'TV apps notification dismissed successfully' 
    });

  } catch (error) {
    console.error('Error dismissing TV apps notification:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}