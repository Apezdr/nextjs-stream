/**
 * What the passes wrote, recorded title by title as each title finishes.
 *
 * syncAllServers keeps one for the whole run and hands it to every server's
 * pass (run/serverPass), which records each title's results into it the moment
 * the title is done. A pass that throws part way through has therefore already
 * handed the run everything it wrote before it threw: the post-sync cache
 * invalidation, the admins' "added" counts and the new-content notices'
 * candidates (run/newContent) all read from here, not from the pass's return
 * value.
 */

import { MediaType, SyncStatus, type SyncResult } from '../core'

/** Display titles of what the passes changed, for post-sync cache invalidation. */
export interface ChangedMedia {
  movies: string[]
  shows: string[]
  seasons: Array<{ title: string; season: number }>
  episodes: Array<{ title: string; season: number; episode: number }>
}

/** A movie or an episode a pass wrote (run/newContent decides whether to announce it). */
export type WrittenTitle =
  | { kind: 'movie'; originalTitle: string }
  | { kind: 'episode'; showOriginalTitle: string; seasonNumber: number; episodeNumber: number }

export interface WrittenMedia {
  changedMedia: ChangedMedia
  /**
   * Movies and episodes a pass wrote this run, created or updated (a title
   * whose pass was skipped on its gate is not here), keyed by title
   * (`movieKey` / `episodeKey`): a title two servers have appears once.
   */
  writtenTitles: Map<string, WrittenTitle>
  /** Record one title's results. */
  record(results: SyncResult[]): void
  /** How many documents the passes created (not updated): the admins' sync notice. */
  addedCounts(): { movies: number; shows: number; episodes: number }
}

/** The key a movie is recorded (and announced) under: its folder name, never its _id. */
export function movieKey(originalTitle: string): string {
  return `movie:${originalTitle}`
}

/** The key an episode is recorded (and announced) under: its show's folder name and its numbers, never an _id. */
export function episodeKey(showOriginalTitle: string, seasonNumber: number, episodeNumber: number): string {
  return `episode:${showOriginalTitle}:S${seasonNumber}E${episodeNumber}`
}

export function createWrittenMedia(): WrittenMedia {
  const changedMedia: ChangedMedia = { movies: [], shows: [], seasons: [], episodes: [] }
  const created = { movies: new Set<string>(), shows: new Set<string>(), episodes: new Set<string>() }
  const writtenTitles = new Map<string, WrittenTitle>()

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
          // A movie's entity id is its folder name.
          writtenTitles.set(movieKey(r.entityId), { kind: 'movie', originalTitle: r.entityId })
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
          // An episode's entity id is "<show> S<n>E<m>"; its show's folder
          // name comes separately, never parsed back out of it.
          if (typeof md.showOriginalTitle === 'string' && md.seasonNumber != null && md.episodeNumber != null) {
            writtenTitles.set(episodeKey(md.showOriginalTitle, md.seasonNumber, md.episodeNumber), {
              kind: 'episode',
              showOriginalTitle: md.showOriginalTitle,
              seasonNumber: md.seasonNumber,
              episodeNumber: md.episodeNumber,
            })
          }
          break
        }
        default:
          break
      }
    }
  }

  return {
    changedMedia,
    writtenTitles,
    record,
    addedCounts: () => ({ movies: created.movies.size, shows: created.shows.size, episodes: created.episodes.size }),
  }
}
