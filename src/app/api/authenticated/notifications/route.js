import { isAuthenticatedAndApproved } from '@src/utils/routeAuth';
import { 
  getUserNotifications, 
  generateNotificationETag,
  getUnreadNotificationCount 
} from '@src/utils/notifications/notificationDatabase.js';
import { MediaDataEnricher } from '@src/utils/notifications/utils/MediaDataEnricher.js';
import { NextResponse } from 'next/server';
import { getSession } from '@src/lib/cachedAuth';
// Use shared ETag helpers for consistency across all endpoints
import { hasMatchingETag, createNotModifiedResponse, createCacheHeaders } from '@src/utils/cache/etagHelpers';

/**
 * GET /api/authenticated/notifications
 * Get notifications for the authenticated user
 */
export async function GET(request) {
  try {
    // Check authentication and approval (supports both web sessions and sessionId)
    const authResult = await isAuthenticatedAndApproved(request);
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
    
    // Check if client has current version using shared helper
    if (hasMatchingETag(request, etag)) {
      return createNotModifiedResponse(etag, {
        'Cache-Control': 'no-cache'
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

    // Return notifications with ETag header for efficient polling
    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-cache',
        ...createCacheHeaders(etag)
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
    const session = await getSession()
    
    if (!session?.user?.id) {
      return new NextResponse(null, { status: 401 });
    }
    
    if (session.user.approved === false) {
      return new NextResponse(null, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const countOnly = searchParams.get('count') === 'true';

    if (countOnly) {
      const unreadCount = await getUnreadNotificationCount(session.user.id);
      const etag = await generateNotificationETag(session.user.id);
      
      // Check if client has current version using shared helper
      if (hasMatchingETag(request, etag)) {
        return createNotModifiedResponse(etag, {
          'Cache-Control': 'no-cache',
          'X-Unread-Count': unreadCount.toString()
        });
      }
      
      return new NextResponse(null, {
        headers: {
          'X-Unread-Count': unreadCount.toString(),
          'Cache-Control': 'no-cache',
          ...createCacheHeaders(etag)
        }
      });
    }

    return new NextResponse(null, { status: 400 });

  } catch (error) {
    console.error('Error getting notification count:', error);
    return new NextResponse(null, { status: 500 });
  }
}
