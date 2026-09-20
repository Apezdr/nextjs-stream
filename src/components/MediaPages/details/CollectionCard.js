import Link from 'next/link'
import IntentPrefetchLink from '@components/MediaPages/IntentPrefetchLink'
import Image from 'next/image'
import { ArrowRightIcon, CheckCircleIcon } from '@heroicons/react/20/solid'
import RetryImage from '@components/RetryImage'
import { classNames, getFullImageUrl } from '@src/utils'
import { getFlatMoviesByCollectionId } from '@src/utils/flatDatabaseUtils'
import { yearOf } from '@src/utils/media/detailsFacts'
import { SectionHeading } from './Primitives'

/**
 * "In this collection": a compact card for the collection itself plus a
 * strip of the sibling films the library owns, the current one marked.
 * Async server component: it reads the owned siblings from the flat catalog
 * inside the page's cached subtree.
 *
 * @param {{ collection: { id: number, name: string, poster_path?: string|null, backdrop_path?: string|null }, currentOriginalTitle: string|null }} props
 */
export default async function CollectionCard({ collection, currentOriginalTitle }) {
  if (!collection?.id) return null

  let siblings = []
  try {
    const owned = await getFlatMoviesByCollectionId(collection.id)
    siblings = (owned || [])
      .filter((m) => m?.originalTitle)
      .sort((a, b) => releaseTime(a) - releaseTime(b))
  } catch (error) {
    console.warn(`[CollectionCard] could not load siblings for collection ${collection.id}: ${error.message}`)
  }

  const collectionHref = `/list/collection/${collection.id}`
  const art = getFullImageUrl(collection.poster_path, 'w342')
  const count = siblings.length

  return (
    <section aria-labelledby="collection-heading">
      <SectionHeading id="collection-heading">In this collection</SectionHeading>
      <div className="rounded-xl bg-white/5 p-4 ring-1 ring-white/10 sm:p-5">
        <div className="flex gap-4">
          <Link href={collectionHref} className="shrink-0 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300">
            <div className="relative h-28 w-[4.7rem] overflow-hidden rounded-md bg-white/10 shadow-md shadow-black/40">
              {art ? <Image src={art} alt="" fill sizes="152px" quality={90} className="object-cover" /> : null}
            </div>
          </Link>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold leading-snug text-white">{collection.name}</p>
            <p className="mt-1 text-sm text-white/55">
              {count > 0 ? `${count} film${count === 1 ? '' : 's'} in your library` : 'Part of a film series'}
            </p>
            <Link
              href={collectionHref}
              className="mt-3 inline-flex items-center gap-1 rounded text-sm font-medium text-blue-300 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300"
            >
              Explore collection
              <ArrowRightIcon className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </div>

        {count > 1 ? (
          <ul className="mt-3 flex gap-3 overflow-x-auto px-2 pb-1 pt-3 scrollbar-none" aria-label="Films in this collection">
            {siblings.map((film) => {
              const current = film.originalTitle === currentOriginalTitle
              const year = yearOf(film.metadata?.release_date)
              return (
                <li key={film._id || film.originalTitle} className="shrink-0">
                  <IntentPrefetchLink
                    href={film.url || `/list/movie/${encodeURIComponent(film.originalTitle)}`}
                    aria-current={current ? 'page' : undefined}
                    aria-label={`${film.title}${year ? ` (${year})` : ''}${current ? ', the film you are viewing' : ''}`}
                    title={current ? `${film.title} — you are here` : year ? `${film.title} (${year})` : film.title}
                    className={classNames(
                      'block w-16 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300',
                      current ? '' : 'opacity-75 transition-opacity hover:opacity-100'
                    )}
                  >
                    <div
                      className={classNames(
                        'relative aspect-[2/3] rounded-md bg-white/10',
                        current ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-[#0f1633]' : 'ring-1 ring-white/10'
                      )}
                    >
                      <div className="absolute inset-0 overflow-hidden rounded-md">
                        <RetryImage
                          src={film.posterURL || '/sorry-image-not-available.jpg'}
                          alt=""
                          fill
                          sizes="128px"
                          quality={90}
                          className="object-cover"
                        />
                      </div>
                      {current ? (
                        <CheckCircleIcon
                          className="absolute -right-2 -top-2 size-5 rounded-full bg-[#0f1633] text-blue-400"
                          aria-hidden="true"
                        />
                      ) : null}
                    </div>
                    <p className={classNames('mt-1.5 truncate text-center text-[11px] leading-tight tabular-nums', current ? 'font-semibold text-white' : 'text-white/60')}>
                      {year || '—'}
                    </p>
                  </IntentPrefetchLink>
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>
    </section>
  )
}

function releaseTime(film) {
  const t = new Date(film?.metadata?.release_date || 0).getTime()
  return Number.isNaN(t) ? 0 : t
}
