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

/**
 * What the passes changed, for post-sync cache invalidation, by folder name
 * (`originalTitle`): the media pages key their per-title cache tags on it,
 * since their URLs carry it. A season's or an episode's `title` is its show's
 * folder name.
 */
export interface ChangedMedia {
  movies: string[]
  shows: string[]
  seasons: Array<{ title: string; season: number }>
  episodes: Array<{ title: string; season: number; episode: number }>
}

export interface WrittenMedia {
  changedMedia: ChangedMedia
  /**
   * Record one title's results.
   *
   * @param results - Everything the pass returned for the title
   * @param originalTitle - The title's folder name (its key in the payload)
   */
  record(results: SyncResult[], originalTitle: string): void
  /** How many documents the passes created (not updated): the admins' sync notice. */
  addedCounts(): { movies: number; shows: number; episodes: number }
}

export function createWrittenMedia(): WrittenMedia {
  const changedMedia: ChangedMedia = { movies: [], shows: [], seasons: [], episodes: [] }
  const created = { movies: new Set<string>(), shows: new Set<string>(), episodes: new Set<string>() }

  /**
   * From the results that completed (were not skipped): the entities changed,
   * by the title's folder name (the media pages' per-title cache tags key on
   * it, never on the display title), and the documents created. Every result
   * a title's pass returns belongs to that title: a show's pass returns its
   * seasons' and episodes' too. A season or an episode without its numbers is
   * left out, since a partial tag would be wrong.
   *
   * "Completed" means the smart upsert ran, not that a field changed; the
   * pass's log compares these counts with the processed counts.
   */
  function record(results: SyncResult[], originalTitle: string) {
    for (const r of results) {
      if (r.status !== SyncStatus.Completed) continue
      const md = r.metadata || {}
      // Set by the services when no document existed before this pass wrote one.
      const wasCreated = md.created === true
      switch (r.mediaType) {
        case MediaType.Movie: {
          if (originalTitle) changedMedia.movies.push(originalTitle)
          if (wasCreated) created.movies.add(r.entityId)
          break
        }
        case MediaType.TVShow: {
          if (originalTitle) changedMedia.shows.push(originalTitle)
          if (wasCreated) created.shows.add(r.entityId)
          break
        }
        case MediaType.Season: {
          if (originalTitle && md.seasonNumber != null) {
            changedMedia.seasons.push({ title: originalTitle, season: md.seasonNumber })
          }
          break
        }
        case MediaType.Episode: {
          if (originalTitle && md.seasonNumber != null && md.episodeNumber != null) {
            changedMedia.episodes.push({ title: originalTitle, season: md.seasonNumber, episode: md.episodeNumber })
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
