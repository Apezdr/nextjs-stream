'use client'

import { memo, useState, useEffect, lazy, Suspense } from 'react'
import { ScrollMenu } from 'react-horizontal-scrolling-menu'
import 'react-horizontal-scrolling-menu/dist/styles.css'
import { LeftArrow, RightArrow } from './arrows'
import { classNames } from 'src/utils'
import { SkeletonCard } from './Card'

const Card = lazy(() => import('./Card'))

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
      itemClassName={classNames(items && items.length == 0 ? 'w-full' : '')}
    >
      {_items.length > 0 ? (
        _items.map(
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
            <Suspense fallback={<SkeletonCard />} key={id}>
              <Card
                itemId={id}
                title={title}
                posterURL={posterURL}
                posterBlurhash={posterBlurhash}
                type={type}
                media={media}
                date={date}
                link={link ?? title}
                logo={logo}
                listtype={listtype}
              />
            </Suspense>
          )
        )
      ) : listtype !== 'recentlyWatched' ? (
        <div className="py-12 flex flex-col gap-2 text-center">
          <span className="text-2xl">☹️</span>
          <strong>Oops we're missing your media, add it to the DB</strong>
        </div>
      ) : (
        <div className="py-12 flex flex-col gap-2 text-center">
          <span className="text-2xl">👀</span>
          <strong>Looks like you haven't watched anything yet</strong>
        </div>
      )}
    </ScrollMenu>
  )
}

export default memo(HorizontalScroll)
