import { redirect, notFound } from 'next/navigation'
import { withApprovedUser } from '@components/HOC/ApprovedUser'
import { getSession } from '@src/lib/cachedAuth'
import { adminUserEmails } from '@src/utils/config'
import { getAdminTVShow } from '@src/utils/admin/flatMediaAdmin'
import TVShowEditor from '@components/Admin/Media/TVShowEditor'

async function TVShowEditorPage({ params, searchParams }) {
  const session = await getSession()
  if ((session && session.user && !adminUserEmails.includes(session.user.email)) || !session) {
    return redirect('/', 'replace')
  }

  const { id } = await params
  const isNew = id === 'new'
  const record = isNew ? null : await getAdminTVShow(id)
  if (!isNew && !record) notFound()

  // Optional deep-link from media detail pages: ?season=4&episode=5 expands the
  // matching season/episode in the editor and scrolls it into view.
  const sp = (await searchParams) || {}
  const initialSeason = Number.parseInt(sp.season, 10)
  const initialEpisode = Number.parseInt(sp.episode, 10)

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <TVShowEditor
        record={record}
        isNew={isNew}
        initialSeason={Number.isNaN(initialSeason) ? null : initialSeason}
        initialEpisode={Number.isNaN(initialEpisode) ? null : initialEpisode}
      />
    </div>
  )
}

export default withApprovedUser(TVShowEditorPage)
