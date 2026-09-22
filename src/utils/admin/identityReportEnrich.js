/**
 * Enrich the processor's identity report with what the catalog knows.
 *
 * The processor lists unmanaged folders as bare library-relative paths. The
 * catalog keys every title on that same folder name (`originalTitle`) and
 * holds its TMDB id, so the report page can pair "Radarr has no file for
 * TMDB 464737" with "the folder on disk pinned to TMDB 464737" by id rather
 * than by guessing at spelling. Nothing here changes the processor's lists;
 * it adds a `catalog` map beside `unmanaged.items`, keyed by path.
 */

/**
 * Split 'movies/The End?' into its media type and folder.
 * @returns {{ mediaType: 'movie'|'tv', folder: string } | null}
 */
export function splitLibraryPath(libraryRelativePath) {
  const path = String(libraryRelativePath || '')
  const slash = path.indexOf('/')
  if (slash <= 0) return null
  const root = path.slice(0, slash)
  const folder = path.slice(slash + 1)
  if (!folder) return null
  if (root === 'movies') return { mediaType: 'movie', folder }
  if (root === 'tv') return { mediaType: 'tv', folder }
  return null
}

/**
 * @param {Object} report            the processor's report (mutated copy returned)
 * @param {Function} lookup          async ({ movies: string[], tv: string[] }) =>
 *                                   Array<{ mediaType, originalTitle, tmdbId, title, id }>
 * @returns {Promise<Object>}        the report with `unmanaged.catalog`
 */
export async function enrichIdentityReport(report, lookup) {
  const items = report?.unmanaged?.items
  if (!Array.isArray(items) || items.length === 0) return report

  const wanted = { movie: [], tv: [] }
  const pathFor = new Map()
  for (const path of items) {
    const split = splitLibraryPath(path)
    if (!split) continue
    wanted[split.mediaType].push(split.folder)
    pathFor.set(`${split.mediaType}:${split.folder}`, path)
  }
  if (!wanted.movie.length && !wanted.tv.length) return report

  let rows = []
  try {
    rows = (await lookup({ movies: wanted.movie, tv: wanted.tv })) || []
  } catch {
    // The report is still useful without the join; the page falls back to
    // pairing by name.
    return report
  }

  const catalog = {}
  for (const row of rows) {
    const path = pathFor.get(`${row.mediaType}:${row.originalTitle}`)
    if (!path) continue
    catalog[path] = {
      tmdbId: Number.isInteger(row.tmdbId) && row.tmdbId > 0 ? row.tmdbId : null,
      title: row.title ?? null,
      id: row.id ?? null,
    }
  }

  return { ...report, unmanaged: { ...report.unmanaged, catalog } }
}
