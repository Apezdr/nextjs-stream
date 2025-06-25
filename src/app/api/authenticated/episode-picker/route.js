import { NextResponse } from 'next/server';
import { isAuthenticatedEither } from '@src/utils/routeAuth';
import { getFlatTVSeasonWithEpisodes } from '@src/utils/flatDatabaseUtils';

/**
 * Episode picker API endpoint
 * Provides episode data for the episode list component
 * Queries:
 *   - title: TV show title
 *   - season: Season number
 */
export async function GET(request) {
  try {
    // Verify authentication (supports both web sessions and sessionId)
    const authResult = await isAuthenticatedEither(request);
    if (authResult instanceof Response) {
      return authResult;
    }

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const title = decodeURIComponent(searchParams.get('title'));
    const season = parseInt(searchParams.get('season'));

    if (!title || isNaN(season)) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Get season data with episodes using the existing flatDatabaseUtils function
    const seasonData = await getFlatTVSeasonWithEpisodes({
      showTitle: title,
      seasonNumber: season,
    });

    if (!seasonData) {
      return NextResponse.json({ error: 'Season not found' }, { status: 404 });
    }

    return NextResponse.json(seasonData);
  } catch (error) {
    console.error('Error fetching episode data:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
