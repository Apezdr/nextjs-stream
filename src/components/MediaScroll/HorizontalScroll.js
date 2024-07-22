'use client'

import { memo, useState, Suspense, useEffect } from 'react'
import { ScrollMenu } from 'react-horizontal-scrolling-menu'
import 'react-horizontal-scrolling-menu/dist/styles.css'
import { LeftArrow, RightArrow } from './arrows'
import Link from 'next/link'
import Image from 'next/image'
import Loading from 'src/app/loading'
import { classNames } from 'src/utils'

const HorizontalScroll = ({ items, listtype }) => {
  const [_items, setItems] = useState(items)

  useEffect(() => {
    setItems(items)
  }, [items])

  return (
    <ScrollMenu
      key={listtype}
      LeftArrow={LeftArrow}
      RightArrow={RightArrow}
      wrapperClassName="w-full p-4 shadow-xl rounded-xl bg-gradient-to-br from-blue-500 via-blue-400 to-blue-600"
      scrollContainerClassName="scrollbar scrollbar-thumb-rounded scrollbar-thumb-blue-200 scrollbar-track-gray-500"
    >
      {_items.map(
        ({
          id,
          posterURL,
          posterBlurhash,
          title,
          type,
          media,
          link,
          date = false,
          logo = false,
        }) => (
          <Card
            itemId={id}
            title={title}
            posterURL={posterURL}
            posterBlurhash={posterBlurhash}
            type={type}
            key={id}
            media={media}
            date={date}
            link={link ?? title}
            logo={logo}
            listtype={listtype}
          />
        )
      )}
    </ScrollMenu>
  )
}

const Card = memo(
  ({
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
    <div className="w-max px-2">
      <div className="card mx-2">
        <Link
          href={`/list/${type}/${link}`}
          className={classNames('relative', 'opacity-80 hover:opacity-100')}
        >
          <Suspense fallback={<Loading />}>
            <div
              className={classNames(
                listtype === 'recentlyWatched' && (logo || media.seasonNumber)
                  ? "inline-block before:content-[''] before:absolute before:top-0 before:left-0 before:w-full before:h-full before:bg-black before:rounded-lg"
                  : '',
                'relative'
              )}
            >
              {logo ? (
                <Image
                  quality={25}
                  width={300}
                  height={300}
                  src={logo}
                  alt={`${title} Logo`}
                  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                  className="absolute z-20 top-[58%] max-w-[70%] mx-auto max-h-14 w-auto inset-0"
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
                <Image
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
                />
              ) : (
                <Image
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
                />
              )}
            </div>
          </Suspense>
          <div className="text-center text-sm mt-2">{title}</div>
          {date && <div className="text-center text-xs text-gray-200">Last Watched: {date}</div>}
        </Link>
      </div>
      <div style={{ height: '20px' }} />
    </div>
  )
)
Card.displayName = 'HorizontalScrollCard'

export default HorizontalScroll
