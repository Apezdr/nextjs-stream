import { isAuthenticatedAndApproved } from '@src/utils/routeAuth';
import {
  getUserNotifications,
  getUnreadNotificationCount
} from '@src/utils/notifications/notificationDatabase.js';
import { MediaDataEnricher } from '@src/utils/notifications/utils/MediaDataEnricher.js';
import { NextResponse } from 'next/server';
import { getSession } from '@src/lib/cachedAuth';
// Use shared ETag helpers for consistency across all endpoints
import { generateETag, hasMatchingETag, createNotModifiedResponse, createCacheHeaders } from '@src/utils/cache/etagHelpers';

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

    // The ETag hashes the response itself, like every other polled route. It
    // used to be built from the newest updatedAt and the unread count, which a
    // dismiss (a hard delete) of any read notification but the newest leaves
    // unchanged, so a 304 would have brought the dismissed one back.
    const responseString = JSON.stringify(result);
    const etag = generateETag(responseString);

    // Check if client has current version using shared helper
    if (hasMatchingETag(request, etag)) {
      return createNotModifiedResponse(etag);
    }

    // Return notifications with ETag header for efficient polling
    return new NextResponse(responseString, {
      headers: {
        'Content-Type': 'application/json',
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
      // A HEAD answer carries nothing but the count, so the count is what its
      // ETag covers
      const etag = generateETag(`unread:${unreadCount}`);

      // Check if client has current version using shared helper
      if (hasMatchingETag(request, etag)) {
        return createNotModifiedResponse(etag, {
          'X-Unread-Count': unreadCount.toString()
        });
      }

      return new NextResponse(null, {
        headers: {
          'X-Unread-Count': unreadCount.toString(),
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
