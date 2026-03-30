import { NextResponse } from 'next/server';
import { getSession } from '@src/lib/cachedAuth';

/**
 * GET /api/auth/approval-status
 * Returns the current user's approval status
 * Used by the pending approval page to poll for approval changes
 */
export async function GET(req) {
  try {
    const session = await getSession();

    if (!session?.user) {
      return NextResponse.json(
        { approved: false, error: 'Not authenticated' },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        approved: !!session.user.approved,
        userId: session.user.id,
      },
      {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching approval status:', error);
    return NextResponse.json(
      { approved: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
