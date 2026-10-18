/**
 * What the passes wrote, recorded title by title as each title finishes.
 *
 * syncAllServers keeps one for the whole run and hands it to every server's
 * pass (run/serverPass), which records each title's results into it the moment
 * the title is done. A pass that throws part way through has therefore already
 * handed the run everything it wrote before it threw: the post-sync cache
 * invalidation and the admins' "added" counts read from here, not from the
 * pass's return value. (The new-content notices do not: run/newContent derives
 * them from the library itself after every full run, so nothing written is
 * lost to a failure between a pass and the notices.)
 */

import { MediaType, SyncStatus, type SyncResult } from '../core'

/** Display titles of what the passes changed, for post-sync cache invalidation. */
export interface ChangedMedia {
  movies: string[]
  shows: string[]
  seasons: Array<{ title: string; season: number }>
  episodes: Array<{ title: string; season: number; episode: number }>
}

export interface WrittenMedia {
  changedMedia: ChangedMedia
  /** Record one title's results. */
  record(results: SyncResult[]): void
  /** How many documents the passes created (not updated): the admins' sync notice. */
  addedCounts(): { movies: number; shows: number; episodes: number }
}

export function createWrittenMedia(): WrittenMedia {
  const changedMedia: ChangedMedia = { movies: [], shows: [], seasons: [], episodes: [] }
  const created = { movies: new Set<string>(), shows: new Set<string>(), episodes: new Set<string>() }

  /**
   * From the results that completed (were not skipped): the entities changed,
   * by display title (the media page cache tags key on it), and the documents
   * created. A movie and a show fall back to the entity id when no display
   * title was stamped; a season or an episode without its numbers is left
   * out, since a partial tag would be wrong.
   *
   * "Completed" means the smart upsert ran, not that a field changed; the
   * pass's log compares these counts with the processed counts.
   */
  function record(results: SyncResult[]) {
    for (const r of results) {
      if (r.status !== SyncStatus.Completed) continue
      const md = r.metadata || {}
      // Set by the services when no document existed before this pass wrote one.
      const wasCreated = md.created === true
      switch (r.mediaType) {
        case MediaType.Movie: {
          const title = md.displayTitle || r.entityId
          if (title) changedMedia.movies.push(title)
          if (wasCreated) created.movies.add(r.entityId)
          break
        }
        case MediaType.TVShow: {
          const title = md.displayTitle || r.entityId
          if (title) changedMedia.shows.push(title)
          if (wasCreated) created.shows.add(r.entityId)
          break
        }
        case MediaType.Season: {
          if (md.displayTitle && md.seasonNumber != null) {
            changedMedia.seasons.push({ title: md.displayTitle, season: md.seasonNumber })
          }
          break
        }
        case MediaType.Episode: {
          if (md.displayTitle && md.seasonNumber != null && md.episodeNumber != null) {
            changedMedia.episodes.push({ title: md.displayTitle, season: md.seasonNumber, episode: md.episodeNumber })
          }
          if (wasCreated) created.episodes.add(r.entityId)
          break
        }
        default:
          break
      }
    }
  }

  return {
    changedMedia,
    record,
    addedCounts: () => ({ movies: created.movies.size, shows: created.shows.size, episodes: created.episodes.size }),
  }
}
