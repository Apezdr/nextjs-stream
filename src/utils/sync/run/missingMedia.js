/**
 * What a server lists that is not in the library: the report's "On <server>
 * but not in the library" section (components/Admin/SyncMediaPopup).
 * syncAllServers reads it after the server's pass, so a title that pass added
 * is not reported; one that is still missing means its write failed, and the
 * next sync retries it.
 *
 * Two projection-only finds (folder names and display titles of every movie
 * and show) and a Set diff against the server's listing (run/listing):
 *   - a movie is missing when its folder name is in neither
 *     `FlatMovies.title` nor `FlatMovies.originalTitle`, and, when
 *     fieldAvailability has an entry for it, some server reports its primary
 *     video (`urls.mp4`, the processor's name for the primary video of any
 *     container): a folder no server has a video for is reported as having
 *     no video file yet instead (run/syncReport noVideoTitles);
 *   - a show is missing when its folder name is in neither
 *     `FlatTVShows.title` nor `FlatTVShows.originalTitle` and the server
 *     lists at least one season for it.
 * Seasons and episodes are not reported.
 */

import { createLogger, logError } from '@src/lib/logger'
import clientPromise from '@src/lib/mongodb'

/**
 * @param {import('./listing').ServerListing} listing - One server's titles,
 *   seasons and episodes, by key (run/listing)
 * @param {Object} fieldAvailability - Cross-server field-availability map (same shape as elsewhere).
 *   A movie the report can name has no document, so the pass syncs it, so its
 *   bucket is in the map.
 * @returns {Promise<{missingMovies: string[], missingTVShows: Array<{title: string, seasons: number}>}>}
 */
export async function computeMissingMedia(listing, fieldAvailability) {
  const log = createLogger('FlatSync.ComputeMissingMedia')

  if (!listing) {
    return { missingMovies: [], missingTVShows: [] }
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')

    // Two projection-only finds — both served by `title_index` /
    // `originalTitle_index`. Index-only scans, no doc fetch.
    const [movieDocs, showDocs] = await Promise.all([
      db.collection('FlatMovies')
        .find({}, { projection: { _id: 0, title: 1, originalTitle: 1 } })
        .toArray(),
      db.collection('FlatTVShows')
        .find({}, { projection: { _id: 0, title: 1, originalTitle: 1 } })
        .toArray(),
    ])

    // Movie title set: union of title + originalTitle, matching legacy.
    const dbMovieTitles = new Set()
    for (const m of movieDocs) {
      if (m.title) dbMovieTitles.add(m.title)
      if (m.originalTitle && m.originalTitle !== m.title) {
        dbMovieTitles.add(m.originalTitle)
      }
    }

    // Show title set: same shape.
    const dbShowTitles = new Set()
    for (const s of showDocs) {
      if (s.title) dbShowTitles.add(s.title)
      if (s.originalTitle && s.originalTitle !== s.title) {
        dbShowTitles.add(s.originalTitle)
      }
    }

    // ─── Missing movies ────────────────────────────────────────────────────
    // Walks the server's movie folders and reports any not in the DB set,
    // unless no server reports a primary video for it (see the module comment).
    const missingMovies = []
    for (const title of listing.movies) {
      if (dbMovieTitles.has(title)) continue
      const fa = fieldAvailability?.movies?.[title]
      if (fa) {
        const responsible = fa['urls.mp4'] || []
        if (responsible.length > 0) missingMovies.push(title)
      } else {
        missingMovies.push(title)
      }
    }

    // ─── Missing TV shows ──────────────────────────────────────────────────
    // Only a show the server lists at least one season for.
    const missingTVShows = []
    for (const [showTitle, seasons] of listing.tv) {
      if (dbShowTitles.has(showTitle)) continue
      const seasonCount = seasons.size
      if (seasonCount > 0) {
        missingTVShows.push({ title: showTitle, seasons: seasonCount })
      }
    }

    if (missingMovies.length > 0 || missingTVShows.length > 0) {
      log.info(
        { missingMovieCount: missingMovies.length, missingShowCount: missingTVShows.length },
        'Computed missing media via targeted queries'
      )
    }

    return { missingMovies, missingTVShows }
  } catch (error) {
    logError(log, error, { context: 'compute_missing_media' })
    return { missingMovies: [], missingTVShows: [] }
  }
}
