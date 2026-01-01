'use server';

import { getFlatTVSeasonWithEpisodes } from '@src/utils/flatDatabaseUtils';

export async function refreshEpisodes({ showTitle, seasonNumber }) {
  try {
    // Fetch fresh data for the season
    const refreshedSeason = await getFlatTVSeasonWithEpisodes({
      showTitle: decodeURIComponent(showTitle),
      seasonNumber: parseInt(seasonNumber)
    });
    
    // Return a properly structured response that our client component can check
    return { 
      success: true, 
      data: refreshedSeason,
      hasEpisodes: !!(refreshedSeason && refreshedSeason.episodes && refreshedSeason.episodes.length > 0)
    };
  } catch (error) {
    console.error('Error refreshing episodes:', error);
    return { success: false, error: error.message, hasEpisodes: false };
  }
}
