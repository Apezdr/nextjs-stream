import { auth } from '@src/lib/auth';
import { NotificationManager } from '@src/utils/notifications/NotificationManager.js';
import { NextResponse } from 'next/server';

/**
 * POST /api/authenticated/notifications/test
 * Create test notifications for the authenticated user
 */
export async function POST(request) {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'all';

    const createdNotifications = [];

    if (type === 'all' || type === 'sync') {
      // Create a sync completion notification
      const syncNotification = await NotificationManager.createSyncComplete(
        session.user.id,
        'Test Server',
        {
          moviesAdded: 5,
          episodesAdded: 12,
          duration: '2.3 minutes'
        }
      );
      createdNotifications.push(syncNotification);
    }

    if (type === 'all' || type === 'content') {
      // Create new content notifications
      const movieNotification = await NotificationManager.createNewContent(
        session.user.id,
        'The Matrix Reloaded',
        'movie'
      );
      createdNotifications.push(movieNotification);

      const episodeNotification = await NotificationManager.createNewContent(
        session.user.id,
        'Breaking Bad - S5E10: Granite State',
        'episode'
      );
      createdNotifications.push(episodeNotification);
    }

    if (type === 'all' || type === 'system') {
      // Create a system alert
      const systemNotification = await NotificationManager.createSystemAlert(
        'System maintenance scheduled for tonight at 2:00 AM EST. Expected downtime: 30 minutes.',
        'medium',
        '/admin'
      );
      // This returns an array for all users, get the one for current user
      const userSystemNotification = systemNotification.find(n => n.userId === session.user.id);
      if (userSystemNotification) {
        createdNotifications.push(userSystemNotification);
      }
    }

    if (type === 'all' || type === 'admin') {
      // Create an admin message
      const adminNotification = await NotificationManager.createAdminMessage(
        'Server Performance Update',
        'New hardware has been installed to improve streaming performance. You should notice faster loading times.',
        'low'
      );
      // This returns an array for all users, get the one for current user
      const userAdminNotification = adminNotification.find(n => n.userId === session.user.id);
      if (userAdminNotification) {
        createdNotifications.push(userAdminNotification);
      }
    }

    if (type === 'all' || type === 'custom') {
      // Create a custom notification
      const customNotification = await NotificationManager.createCustom(
        session.user.id,
        {
          type: 'info',
          title: 'Welcome to the Notification System!',
          message: 'This is a test notification to demonstrate the system functionality.',
          priority: 'medium',
          category: 'general',
          icon: 'info',
          actionText: 'Learn More',
          actionUrl: '/about'
        }
      );
      createdNotifications.push(customNotification);
    }

    return NextResponse.json({
      success: true,
      message: `Created ${createdNotifications.length} test notifications`,
      notifications: createdNotifications
    });

  } catch (error) {
    console.error('Error creating test notifications:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message }, 
      { status: 500 }
    );
  }
}

/**
 * GET /api/authenticated/notifications/test
 * Get information about available test notification types
 */
export async function GET() {
  return NextResponse.json({
    message: 'Test notification endpoint',
    usage: {
      create: 'POST /api/authenticated/notifications/test?type={type}',
      types: [
        'all - Create all types of notifications',
        'sync - Create sync completion notification', 
        'content - Create new content notifications',
        'system - Create system alert notification',
        'admin - Create admin message notification',
        'custom - Create custom notification'
      ]
    },
    examples: [
      'POST /api/authenticated/notifications/test',
      'POST /api/authenticated/notifications/test?type=sync',
      'POST /api/authenticated/notifications/test?type=content'
    ]
  });
}
