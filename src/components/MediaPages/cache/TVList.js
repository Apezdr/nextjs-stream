import PageContentAnimatePresence from '@components/HOC/PageContentAnimatePresence'
import Detailed from '@components/Poster/Detailed'
import Link from 'next/link'
import { cache, memo } from 'react'
import clientPromise from '@src/lib/mongodb'
import { fetchMetadataMultiServer } from '@src/utils/admin_utils'
import { getFlatTVList } from '@src/utils/flatDatabaseUtils'

const variants = {
  hidden: { opacity: 0, x: 0, y: -20 },
  enter: { opacity: 1, x: 0, y: 0 },
}
const variants_height = {
  hidden: { opacity: 0 },
  enter: { opacity: 1 },
}

const TVList = async () => {
  const tvList = await getFlatTVList()
  return (
    <>
      {tvList.map(function (tv, index) {
        return (
          <li key={tv.title} className="relative min-w-[250px]">
            <PageContentAnimatePresence
              _key={tv.title + '-AnimationCont'}
              variants={variants}
              transition={{
                type: 'linear',
                duration: 0.4,
              }}
            >
              <Link href={`/list/tv/${encodeURIComponent(tv.title)}`} className="group">
                <Detailed tvShow={tv} check4kandHDR={true} />
              </Link>
            </PageContentAnimatePresence>
          </li>
        )
      })}
    </>
  )
}

export default memo(TVList)
