// src/app/api/authenticated/media-list/season-episodes/route.ts
// GET: whether a season that showed no episodes has some now. NoEpisodesFound's
// "Try again" asks, then refreshes the page to render them. It was a Server
// Action, which the "View as" guard refuses like every action; a GET passes it.
//
//   GET ?showTitle=&seasonNumber=   { success, hasEpisodes }
//
// It answers only yes or no, never the episodes themselves (their video URLs
// among them). showTitle arrives decoded once, by URLSearchParams, and is used
// as given: decoding it again throws for a title with a '%'. It must be a
// non-empty string and the season a plain number, or the answer is no without
// a query.
import { approvedGate } from '@src/lib/roles/gates'
import { libraryAccessFor } from '@src/lib/roles/libraryAccess'
import { createLogger } from '@src/lib/logger'
import { getFlatTVSeasonWithEpisodes } from '@src/utils/flatDatabaseUtils'

const log = createLogger('API.MediaList')

const answer = (success: boolean, hasEpisodes: boolean) => Response.json({ success, hasEpisodes })

export async function GET(request: Request) {
  const user = await approvedGate.route()
  if (user instanceof Response) return user

  const query = new URL(request.url).searchParams
  const showTitle = query.get('showTitle')
  const seasonNumber = query.get('seasonNumber')
  if (typeof showTitle !== 'string' || showTitle.length === 0 || !/^\d{1,4}$/.test(String(seasonNumber))) {
    return answer(false, false)
  }

  try {
    // A show outside the caller's library scope has no episodes, as far as they can tell
    const season = await getFlatTVSeasonWithEpisodes({
      access: await libraryAccessFor(user),
      showTitle,
      seasonNumber: parseInt(String(seasonNumber), 10),
    })
    return answer(true, Boolean(season?.episodes?.length))
  } catch (error) {
    // The details stay in the server log
    log.error({ error: (error as Error)?.message }, 'Season episode check failed')
    return answer(false, false)
  }
}
