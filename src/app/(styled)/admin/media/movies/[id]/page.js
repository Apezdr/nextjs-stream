import { redirect, notFound } from 'next/navigation'
import { withApprovedUser } from '@components/HOC/ApprovedUser'
import { getSession } from '@src/lib/cachedAuth'
import { adminUserEmails, getAllServers, getDefaultServer } from '@src/utils/config'
import { getAdminMovie } from '@src/utils/admin/flatMediaAdmin'
import MovieEditor from '@components/Admin/Media/MovieEditor'

/**
 * Determine which server hosts this movie and where a TMDB-config override
 * would actually land, so the editor can frame edits correctly in a
 * multi-server setup.
 *
 * The TMDB-config dialog always writes to the default (locally-authenticated)
 * server. When the movie is hosted on a *different* server, that write becomes
 * a local "placeholder" override (a tmdb.config in a video-less folder) that
 * wins via priority (lower number = higher) without modifying the source
 * server. This object lets the dialog say so plainly.
 */
function computeMovieOwnership(record) {
  if (!record) return null
  const hostingServerId = record.videoSource || record.metadataSource || record.posterSource || null
  const defaultServer = getDefaultServer()
  const byId = new Map(getAllServers().map((s) => [s.id, s]))
  const hosting = hostingServerId ? byId.get(hostingServerId) : null
  const isLocalOverride = Boolean(hostingServerId) && hostingServerId !== defaultServer.id
  return {
    isLocalOverride,
    hostingServerLabel: hosting?.id || hostingServerId || 'unknown',
    hostingPriority: hosting?.priority ?? null,
    writeTargetLabel: defaultServer.id,
    writeTargetPriority: defaultServer.priority,
    // The override only takes effect if the write target outranks (or ties) the
    // hosting server (lower priority number = higher precedence).
    overrideWillWin: hosting ? defaultServer.priority <= hosting.priority : true,
  }
}

async function MovieEditorPage({ params }) {
  const session = await getSession()
  if ((session && session.user && !adminUserEmails.includes(session.user.email)) || !session) {
    return redirect('/', 'replace')
  }

  const { id } = await params
  const isNew = id === 'new'
  const record = isNew ? null : await getAdminMovie(id)
  if (!isNew && !record) notFound()

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <MovieEditor record={record} isNew={isNew} ownership={computeMovieOwnership(record)} />
    </div>
  )
}

export default withApprovedUser(MovieEditorPage)
