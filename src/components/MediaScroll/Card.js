'use client'
import Link from 'next/link'
import { memo, Suspense, lazy } from 'react'
import { classNames } from 'src/utils'

const LazyImage = lazy(() => import('next/image'))

const Card = ({
  onClick,
  title,
  itemId,
  posterURL,
  type,
  media,
  posterBlurhash = null,
  date,
  link,
  logo,
  listtype,
}) => (
  <Suspense fallback={<SkeletonCard />}>
    <div className="w-max px-2">
      <div className="card mx-2">
        <Link
          href={`/list/${type}/${link}`}
          className={classNames('relative', 'opacity-80 hover:opacity-100')}
        >
          <div
            className={classNames(
              listtype === 'recentlyWatched' && (logo || media.seasonNumber)
                ? "inline-block before:content-[''] before:absolute before:top-0 before:left-0 before:w-full before:h-full before:bg-black before:rounded-lg"
                : '',
              'relative'
            )}
          >
            {logo ? (
              <LazyImage
                quality={25}
                width={300}
                height={300}
                src={logo}
                alt={`${title} Logo`}
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                className="absolute z-20 top-[58%] max-w-[70%] mx-auto max-h-14 w-auto inset-0"
                loading="lazy"
              />
            ) : null}
            {media.seasonNumber ? (
              <div className="absolute z-20 top-[86%] max-w-[70%] mx-auto max-h-14 h-5 justify-center text-center w-auto inset-0">
                <div className="bg-gray-200 bg-opacity-20 rounded-xl flex flex-row gap-1 px-[10px] py-[2px] justify-center">
                  <span className="text-xs text-gray-300">Season {media.seasonNumber}</span>
                  <span className="text-xs">|</span>
                  <span className="text-xs font-bold">Episode {media.episode.episodeNumber}</span>
                </div>
              </div>
            ) : null}
            {posterBlurhash ? (
              <LazyImage
                quality={25}
                width={300}
                height={300}
                src={posterURL}
                placeholder="blur"
                blurDataURL={`data:image/png;base64,${posterBlurhash}`}
                alt={title}
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                className={classNames(
                  listtype === 'recentlyWatched' && (logo || media.seasonNumber)
                    ? 'opacity-30'
                    : '',
                  'rounded-lg shadow-xl h-[225px] w-auto mx-auto'
                )}
                loading="lazy"
              />
            ) : (
              <LazyImage
                quality={25}
                width={300}
                height={300}
                src={posterURL}
                alt={title}
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                className={classNames(
                  listtype === 'recentlyWatched' && (logo || media.seasonNumber)
                    ? 'opacity-30'
                    : '',
                  'rounded-lg shadow-xl h-[225px] w-auto mx-auto'
                )}
                loading="lazy"
              />
            )}
          </div>
          <div className="text-center text-sm mt-2">{title}</div>
          {date && <div className="text-center text-xs text-gray-200">Last Watched: {date}</div>}
        </Link>
      </div>
      <div style={{ height: '20px' }} />
    </div>
  </Suspense>
)
Card.displayName = 'HorizontalScrollCard'

const SkeletonCard = memo(() => (
  <div className="w-max px-2">
    <div className="card mx-2 animate-pulse">
      <div className="relative bg-gray-300 rounded-lg h-[225px] w-[150px] mx-auto"></div>
      <div className="text-center text-sm mt-2 bg-gray-300 h-4 w-3/4 mx-auto rounded"></div>
      <div className="text-center text-xs text-gray-300 h-3 w-1/2 mx-auto rounded mt-1"></div>
    </div>
    <div style={{ height: '20px' }} />
  </div>
))

SkeletonCard.displayName = 'SkeletonCard'
export default memo(Card)
export { SkeletonCard }
