import { NextResponse } from 'next/server';
import clientPromise from '@src/lib/mongodb';
import { getSession } from '@src/lib/cachedAuth';
import { userQueries } from '@src/lib/userQueries';

/**
 * POST /api/authenticated/user/preferences/dismiss-tv-apps-notification
 * Mark TV apps notification as dismissed for the current user
 */
export async function POST(request) {
  try {
    const session = await getSession();

    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    
    // Update user's preferences to mark TV apps notification as dismissed
    const result = await userQueries.updateByIdCustom(
      userId,
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