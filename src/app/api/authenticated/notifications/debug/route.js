import { auth } from '@src/lib/auth';
import { NextResponse } from 'next/server';
import clientPromise from '@src/lib/mongodb';

/**
 * Debug endpoint to check notification data and user ID formats
 */
export async function GET(request) {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const client = await clientPromise;
    const db = client.db('Media');
    
    // Get session info
    const sessionInfo = {
      userId: session.user.id,
      userIdType: typeof session.user.id,
      userEmail: session.user.email,
      userIdStringified: String(session.user.id)
    };

    // Get all notifications in the database (first 10)
    const allNotifications = await db.collection('Notifications')
      .find({})
      .limit(10)
      .toArray();

    // Get notifications specifically for this user using different ID formats
    const [
      notificationsByStringId,
      notificationsByObjectId,
      notificationsByDirectMatch
    ] = await Promise.all([
      // Try as string
      db.collection('Notifications')
        .find({ userId: String(session.user.id) })
        .limit(10)
        .toArray(),
      
      // Try as ObjectId (if possible)
      (() => {
        try {
          const { ObjectId } = require('mongodb');
          return db.collection('Notifications')
            .find({ userId: new ObjectId(session.user.id) })
            .limit(10)
            .toArray();
        } catch (e) {
          return Promise.resolve([]);
        }
      })(),
      
      // Try direct match (whatever format it is)
      db.collection('Notifications')
        .find({ userId: session.user.id })
        .limit(10)
        .toArray()
    ]);

    // Get unique user IDs from all notifications to see formats
    const uniqueUserIds = await db.collection('Notifications')
      .distinct('userId');

    const debugInfo = {
      sessionInfo,
      counts: {
        totalNotifications: allNotifications.length,
        byStringId: notificationsByStringId.length,
        byObjectId: notificationsByObjectId.length,
        byDirectMatch: notificationsByDirectMatch.length
      },
      uniqueUserIds: uniqueUserIds.map(uid => ({
        value: uid,
        type: typeof uid,
        stringified: String(uid)
      })),
      sampleNotifications: allNotifications.map(notification => ({
        _id: notification._id,
        userId: notification.userId,
        userIdType: typeof notification.userId,
        title: notification.title,
        type: notification.type,
        createdAt: notification.createdAt
      }))
    };

    return NextResponse.json(debugInfo);

  } catch (error) {
    console.error('Debug endpoint error:', error);
    return NextResponse.json(
      { error: 'Debug failed', details: error.message }, 
      { status: 500 }
    );
  }
}
