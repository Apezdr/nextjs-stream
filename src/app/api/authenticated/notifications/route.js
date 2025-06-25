import { auth } from '@src/lib/auth';
import { isAuthenticatedEither } from '@src/utils/routeAuth';
import { 
  getUserNotifications, 
  generateNotificationETag,
  getUnreadNotificationCount 
} from '@src/utils/notifications/notificationDatabase.js';
import { MediaDataEnricher } from '@src/utils/notifications/utils/MediaDataEnricher.js';
import { NextResponse } from 'next/server';

/**
 * GET /api/authenticated/notifications
 * Get notifications for the authenticated user
 */
export async function GET(request) {
  try {
    // Check authentication (supports both web sessions and sessionId)
    const authResult = await isAuthenticatedEither(request);
    if (authResult instanceof Response) {
      return authResult;
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page')) || 1;
    const limit = parseInt(searchParams.get('limit')) || 20;
    const unreadOnly = searchParams.get('unreadOnly') === 'true';
    const category = searchParams.get('category') || null;
    const priority = searchParams.get('priority') || null;
    const enrich = searchParams.get('enrich') !== 'false'; // Default to true

    // Generate ETag for caching
    const etag = await generateNotificationETag(authResult.id);
    
    // Check if client has current version
    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch === etag) {
      return new NextResponse(null, { 
        status: 304,
        headers: {
          'ETag': etag,
          'Cache-Control': 'no-cache'
        }
      });
    }

    // Get notifications
    const result = await getUserNotifications(authResult.id, {
      page,
      limit,
      unreadOnly,
      category,
      priority
    });

    // Enrich notifications with fresh media data if requested
    if (enrich && result.notifications && result.notifications.length > 0) {
      try {
        result.notifications = await MediaDataEnricher.enrichNotificationBatch(result.notifications);
      } catch (enrichError) {
        console.error('Error enriching notifications:', enrichError);
        // Continue with un-enriched notifications rather than failing
      }
    }

    return NextResponse.json(result, {
      headers: {
        'ETag': etag,
        'Cache-Control': 'no-cache'
      }
    });

  } catch (error) {
    console.error('Error fetching notifications:', error);
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    );
  }
}

/**
 * GET /api/authenticated/notifications?count=true
 * Get unread notification count only
 */
export async function HEAD(request) {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return new NextResponse(null, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const countOnly = searchParams.get('count') === 'true';

    if (countOnly) {
      const unreadCount = await getUnreadNotificationCount(session.user.id);
      const etag = await generateNotificationETag(session.user.id);
      
      return new NextResponse(null, {
        headers: {
          'X-Unread-Count': unreadCount.toString(),
          'ETag': etag,
          'Cache-Control': 'no-cache'
        }
      });
    }

    return new NextResponse(null, { status: 400 });

  } catch (error) {
    console.error('Error getting notification count:', error);
    return new NextResponse(null, { status: 500 });
  }
}
