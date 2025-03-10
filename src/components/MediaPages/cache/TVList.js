import PageContentAnimatePresence from '@components/HOC/PageContentAnimatePresence'
import Detailed from '@components/Poster/Detailed'
import Link from 'next/link'
import { cache, memo } from 'react'
import clientPromise from '@src/lib/mongodb'
import { fetchMetadataMultiServer } from '@src/utils/admin_utils'

const variants = {
  hidden: { opacity: 0, x: 0, y: -20 },
  enter: { opacity: 1, x: 0, y: 0 },
}
const variants_height = {
  hidden: { opacity: 0 },
  enter: { opacity: 1 },
}

const TVList = async (latestUpdateTimestamp) => {
  const tvList = await getAndUpdateMongoDB(latestUpdateTimestamp)
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

const getAndUpdateMongoDB = cache(async () => {
  const client = await clientPromise
  const tvprograms = await client
    .db('Media')
    .collection('TV')
    .find(
      {},
      {
        projection: {
          _id: 1,
          title: 1,
          metadata: 1,
          posterURL: 1,
          posterBlurhash: 1,
          posterBlurhashSource: 1,
          'seasons.seasonNumber': 1,
          'seasons.episodes.hdr': 1,
          'seasons.episodes.dimensions': 1,
          'seasons.title': 1,
          'seasons.season_poster': 1,
          'seasons.posterSource': 1,
          'seasons.seasonPosterBlurhash': 1,
          'seasons.seasonPosterBlurhashSource': 1,
          'seasons.metadata.Genre': 1,
        },
      }
    )
    .sort({ title: 1 })
    .toArray()

  // const updatedTVShows = await client
  //   .db('Media')
  //   .collection('TV')
  //   .find({})
  //   .sort({ _id: -1 })
  //   .toArray()

  tvprograms.sort((a, b) => {
    const dateA = new Date(a.metadata?.last_air_date)
    const dateB = new Date(b.metadata?.last_air_date)

    // Sorting in descending order
    return dateB - dateA
  })

  // Convert MongoDB objects to plain JavaScript objects
  const plainTVShows = await Promise.all(
    tvprograms.map(async (tv) => {
      if (tv.posterBlurhash) {
        // Attach the promise; once it resolves, you'll get the blurhash base64 string.
        tv.posterBlurhashPromise  = fetchMetadataMultiServer(tv.posterBlurhashSource, tv.posterBlurhash, 'blurhash', 'tv', tv.title)
      }
      return {
        ...tv,
        _id: tv._id.toString(), // Convert ObjectId to string
        title: tv.title,
      }
    })
  )

  return plainTVShows
})

export default memo(TVList)
