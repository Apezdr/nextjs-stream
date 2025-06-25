import { NextResponse } from 'next/server';
import { auth } from '@src/lib/auth';
import { deleteNotification } from '@src/utils/notifications/notificationDatabase';

/**
 * POST /api/authenticated/notifications/dismiss
 * Dismiss (delete) a notification completely
 */
export async function POST(request) {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: 'Notification ID is required' }, { status: 400 });
    }

    const userId = session.user.id;
    
    // Delete the notification completely
    const result = await deleteNotification(id, userId);
    
    if (!result) {
      return NextResponse.json({ error: 'Notification not found or already dismissed' }, { status: 404 });
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Notification dismissed successfully' 
    });

  } catch (error) {
    console.error('Error dismissing notification:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
