/**
 * How many seasons and episodes a server says a show has, counting only what
 * the sync can store: the expected side of the show's drift check
 * (TVShowSyncService), one rule for wherever the season keys come from.
 *
 * A season key counts when it has a number in it, the rule
 * SeasonSyncService.parseSeasonNumber stores seasons by. A folder with no number
 * ("Specials") is never written, so counting it, or its episodes, would make the
 * show look short of seasons and episodes, and so never skippable, for good.
 */

const STORED_SEASON_KEY = /(?:season_?|s)?(\d+)/i

export interface ExpectedCounts {
  seasons: number
  episodes: number
}

/**
 * @param seasons - Each season key the server sent, with how many episode keys it has
 */
export function expectedSeasonCounts(seasons: Iterable<readonly [string, number]>): ExpectedCounts {
  const counts: ExpectedCounts = { seasons: 0, episodes: 0 }
  for (const [seasonKey, episodeCount] of seasons) {
    if (!STORED_SEASON_KEY.test(seasonKey)) continue
    counts.seasons += 1
    counts.episodes += episodeCount
  }
  return counts
}
