import { auth } from '@src/lib/auth';
import { 
  markNotificationAsRead, 
  markNotificationsAsRead,
  markAllNotificationsAsRead 
} from '@src/utils/notifications/notificationDatabase.js';
import { NextResponse } from 'next/server';

/**
 * POST /api/authenticated/notifications/mark-read
 * Mark notifications as read
 * 
 * Body can contain:
 * - { id: "notificationId" } - Mark single notification as read
 * - { ids: ["id1", "id2"] } - Mark multiple notifications as read
 * - { all: true } - Mark all notifications as read
 */
export async function POST(request) {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { id, ids, all } = body;

    let result;
    let message;

    if (all) {
      // Mark all notifications as read
      result = await markAllNotificationsAsRead(session.user.id);
      message = `Marked ${result} notifications as read`;
    } else if (ids && Array.isArray(ids)) {
      // Mark multiple notifications as read
      result = await markNotificationsAsRead(ids, session.user.id);
      message = `Marked ${result} notifications as read`;
    } else if (id) {
      // Mark single notification as read
      result = await markNotificationAsRead(id, session.user.id);
      message = result ? 'Notification marked as read' : 'Notification not found';
    } else {
      return NextResponse.json(
        { error: 'Invalid request body. Provide id, ids, or all.' }, 
        { status: 400 }
      );
    }

    return NextResponse.json({ 
      success: true, 
      message,
      affected: result 
    });

  } catch (error) {
    console.error('Error marking notifications as read:', error);
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    );
  }
}
