import Link from 'next/link'
import CreditsPanel from '@components/MediaPages/details/CreditsPanel'
import CreditsStatus from '@components/Admin/Media/CreditsStatus'
import { getCreditsCatalog, getLibraryCreditsRecords } from '@src/utils/credits/catalog'
import { mediaLinkParam } from '@src/utils/media/urlParser'
import { tvHrefs } from '@src/utils/media/tvFacts'

/**
 * The "Credits & licenses" page (CREDITS_SIDECAR.md, section 8): the
 * library's own credits in full, then the titles that have credits, each a
 * link to the credits panel on its page. A show with no credits of its own
 * links straight to its credited episodes. Title credits are not repeated
 * here.
 *
 * An admin also sees each server's library credits sync: a failure keeps the
 * last valid credits on the page, and says so only here.
 *
 * @param {{ user: { limitedAccess?: boolean, role?: string } }} props
 */
export default async function CreditsCatalogPage({ user }) {
  const isAdmin = user?.role === 'admin'
  const [{ library, titles }, records] = await Promise.all([
    getCreditsCatalog({ includeTitles: user?.limitedAccess !== true }),
    isAdmin ? getLibraryCreditsRecords() : [],
  ])
  return <CreditsCatalog library={library} titles={titles} failing={records.filter((record) => record.creditsStatus)} />
}

/**
 * The page itself, from what CreditsCatalogPage read.
 *
 * @param {{ library: object|null, titles: Array<object>, failing?: Array<object> }} props
 */
export function CreditsCatalog({ library, titles, failing = [] }) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-24 pt-28 text-white sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold sm:text-3xl">Credits &amp; licenses</h1>
      <p className="mt-2 max-w-[65ch] text-sm text-white/80">
        The people and works behind what this library shows, and the licenses they are shared under.
      </p>

      {failing.length > 0 ? (
        <div className="mt-8 space-y-4" aria-label="Library credits sync (admins only)">
          {failing.map((record) => (
            <CreditsStatus key={record._id} record={record} scope="library" />
          ))}
        </div>
      ) : null}

      {!library && titles.length === 0 ? (
        <p className="mt-10 text-white/80">No credits are available.</p>
      ) : null}

      {library ? (
        <div className="mt-10">
          <CreditsPanel credits={library} id="library-credits" title="Shared artwork" />
        </div>
      ) : null}

      {titles.length > 0 ? (
        <section aria-labelledby="credited-titles-heading" className="mt-12">
          <h2 id="credited-titles-heading" className="text-lg font-semibold text-white">
            Titles with credits
          </h2>
          <ul role="list" className="mt-4 divide-y divide-white/10 rounded-xl bg-black/45 ring-1 ring-white/15">
            {titles.map((item) => (
              <li key={`${item.type}:${item.id}`} className="px-5 py-4">
                <TitleLink item={item} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  )
}

const LINK_CLASSES =
  'rounded text-blue-300 underline-offset-2 hover:text-white hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300'

function TitleLink({ item }) {
  if (item.type === 'movie') {
    const param = mediaLinkParam(item)
    return (
      <div>
        {param ? (
          <Link href={`/list/movie/${param}#credits`} className={`text-base font-medium ${LINK_CLASSES}`}>
            {item.title}
          </Link>
        ) : (
          <span className="text-base font-medium">{item.title}</span>
        )}
        <span className="ml-2 text-xs uppercase tracking-wide text-white/60">Movie</span>
      </div>
    )
  }

  const hrefs = tvHrefs({ originalTitle: item.originalTitle })
  return (
    <div>
      {item.hasCredits ? (
        <Link href={`${hrefs.show}#credits`} className={`text-base font-medium ${LINK_CLASSES}`}>
          {item.title}
        </Link>
      ) : (
        <span className="text-base font-medium">{item.title}</span>
      )}
      <span className="ml-2 text-xs uppercase tracking-wide text-white/60">Show</span>
      {item.episodes?.length > 0 ? (
        <ul role="list" aria-label={`Episodes of ${item.title} with their own credits`} className="mt-2 space-y-1 pl-4 text-sm">
          {item.episodes.map((episode) => {
            const href = tvHrefs({ originalTitle: item.originalTitle, seasonNumber: episode.seasonNumber, episodeNumber: episode.episodeNumber }).episode
            const label = `S${episode.seasonNumber} E${episode.episodeNumber}${episode.title ? ` · ${episode.title}` : ''}`
            return (
              <li key={`${episode.seasonNumber}:${episode.episodeNumber}`}>
                <Link href={`${href}#credits`} className={LINK_CLASSES}>
                  {label}
                </Link>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
