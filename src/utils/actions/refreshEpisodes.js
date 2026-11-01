'use server';

import { requireApprovedViewer } from '@src/lib/actionViewer';
import { getFlatTVSeasonWithEpisodes } from '@src/utils/flatDatabaseUtils';

/**
 * Whether a season that showed no episodes has some now. NoEpisodesFound's
 * retry calls it, then refreshes the page to render them. A public POST
 * endpoint like every action: it checks its caller, and answers only yes or
 * no. It used to return the season's full episode documents, video URLs
 * included, to anyone holding its ID.
 *
 * showTitle arrives decoded (the season page decodes its param once), so it is
 * used as given: decoding it again threw for a title with a '%'. An action's
 * arguments are whatever the caller sends, so it must be a string: an object
 * like { $regex } would reach the Mongo query as an operator.
 */
export async function refreshEpisodes({ showTitle, seasonNumber } = {}) {
  const validTitle = typeof showTitle === 'string' && showTitle.length > 0;
  const validSeason = /^\d{1,4}$/.test(String(seasonNumber));
  // Back to this season after signing in
  await requireApprovedViewer(
    validTitle && validSeason ? `/list/tv/${encodeURIComponent(showTitle)}/${seasonNumber}` : '/list/tv'
  );
  if (!validTitle || !validSeason) return { success: false, hasEpisodes: false };
  try {
    const refreshedSeason = await getFlatTVSeasonWithEpisodes({
      showTitle,
      seasonNumber: parseInt(seasonNumber, 10)
    });

    return {
      success: true,
      hasEpisodes: !!(refreshedSeason && refreshedSeason.episodes && refreshedSeason.episodes.length > 0)
    };
  } catch (error) {
    // The details stay in the server log
    console.error('Error refreshing episodes:', error);
    return { success: false, hasEpisodes: false };
  }
}
