/**
 * Lightweight missing-media detector.
 *
 * Replaces the missing-media portion of `buildEnhancedFlatDBStructure` for
 * the main-orchestration call path. The legacy function pulled every record
 * from FlatMovies / FlatTVShows / FlatSeasons / FlatEpisodes, built 15
 * lookup Maps, and held them on the heap for the duration of the sync —
 * SigNoz observed this as ~414 MB of `old_space` per cycle.
 *
 * For the missing-media report, all we actually need is two cheap
 * projection-only finds and an in-memory diff against `fileServer` keys.
 * Seasons/episodes branches of the legacy detector are dead at the call
 * site (sync.js only surfaces `missingMovies` and `missingTVShows`), so we
 * don't compute them.
 *
 * Predicate parity with `memoryUtils.js:197-274` (verified):
 *   - Movie is missing iff its file-server title is not in
 *     `db.FlatMovies.title ∪ db.FlatMovies.originalTitle`, with the same
 *     fieldAvailability rescue: a title with `fieldAvailability.movies[t]`
 *     present is only reported missing when its `urls.mp4` array has
 *     responsible servers.
 *   - TV show is missing iff its file-server title is not in
 *     `db.FlatTVShows.title ∪ db.FlatTVShows.originalTitle`, AND the file
 *     server reports at least one season for it (legacy skips empty shows).
 */

import { createLogger, logError } from '@src/lib/logger'
import clientPromise from '@src/lib/mongodb'

/**
 * @param {Object} fileServer - One server's manifest: `{ movies: {...}, tv: {...}, ... }`
 * @param {Object} fieldAvailability - Cross-server field-availability map (same shape as elsewhere)
 * @returns {Promise<{missingMovies: string[], missingTVShows: Array<{title: string, seasons: number}>}>}
 */
export async function computeMissingMedia(fileServer, fieldAvailability) {
  const log = createLogger('FlatSync.ComputeMissingMedia')

  if (!fileServer || (!fileServer.movies && !fileServer.tv)) {
    return { missingMovies: [], missingTVShows: [] }
  }

  try {
    const client = await clientPromise
    const db = client.db('Media')

    // Two projection-only finds — both served by `title_index` /
    // `originalTitle_index`. Index-only scans, no doc fetch.
    const [movieDocs, showDocs] = await Promise.all([
      fileServer.movies
        ? db.collection('FlatMovies')
            .find({}, { projection: { _id: 0, title: 1, originalTitle: 1 } })
            .toArray()
        : Promise.resolve([]),
      fileServer.tv
        ? db.collection('FlatTVShows')
            .find({}, { projection: { _id: 0, title: 1, originalTitle: 1 } })
            .toArray()
        : Promise.resolve([]),
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
    // Walks the file-server's movie titles and reports any not in the DB
    // set, applying the same fieldAvailability rescue as legacy code at
    // memoryUtils.js:217-225.
    const missingMovies = []
    if (fileServer.movies) {
      for (const title of Object.keys(fileServer.movies)) {
        if (dbMovieTitles.has(title)) continue
        const fa = fieldAvailability?.movies?.[title]
        if (fa) {
          const responsible = fa['urls.mp4'] || []
          if (responsible.length > 0) missingMovies.push(title)
        } else {
          missingMovies.push(title)
        }
      }
    }

    // ─── Missing TV shows ──────────────────────────────────────────────────
    // Legacy only reports a show when the file server lists at least one
    // season for it (memoryUtils.js:267-274). Preserved here.
    const missingTVShows = []
    if (fileServer.tv) {
      for (const showTitle of Object.keys(fileServer.tv)) {
        if (dbShowTitles.has(showTitle)) continue
        const showData = fileServer.tv[showTitle]
        const seasonCount = showData?.seasons ? Object.keys(showData.seasons).length : 0
        if (seasonCount > 0) {
          missingTVShows.push({ title: showTitle, seasons: seasonCount })
        }
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
