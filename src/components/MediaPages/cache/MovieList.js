import PageContentAnimatePresence from '@components/HOC/PageContentAnimatePresence'
import MediaPoster from '@components/MediaPoster'
import { CaptionSVG } from '@components/SVGIcons'
import { TotalRuntime } from '@components/watched'
import Link from 'next/link'
import { cache, memo, Suspense } from 'react'
import clientPromise from '@src/lib/mongodb'
import { fetchMetadataMultiServer } from '@src/utils/admin_utils'
import SkeletonCard from '@components/SkeletonCard'

const variants = {
  hidden: { opacity: 0, x: 0, y: -20 },
  enter: { opacity: 1, x: 0, y: 0 },
}
const variants_height = {
  hidden: { opacity: 0 },
  enter: { opacity: 1 },
}

const MovieList = async ({ latestUpdateTimestamp }) => {
  const movieList = await getAndUpdateMongoDB(latestUpdateTimestamp)
  return (
    <>
      {movieList.map((movie, index) => (
        <li key={movie.title} className="relative min-w-[250px] max-w-sm">
          <PageContentAnimatePresence
            _key={movie.title + '-AnimationCont'}
            variants={variants}
            transition={{
              type: 'linear',
              duration: 0.4,
            }}
          >
            <Link href={`movie/${encodeURIComponent(movie.title)}`} className="group">
              <div className="relative block w-auto mx-auto overflow-hidden rounded-lg focus-within:ring-2 focus-within:ring-indigo-500 focus-within:ring-offset-2 focus-within:ring-offset-gray-100 ">
                <Suspense fallback={<SkeletonCard key={index} heightClass={'h-[582px]'} imageOnly />}><MediaPoster movie={movie} /></Suspense>
                <button type="button" className="absolute inset-0 focus:outline-none">
                  <span className="sr-only">View details for {movie.title}</span>
                </button>
              </div>
              <p className="pointer-events-none mt-2 block text-sm font-medium text-gray-200 text-center">
                <TotalRuntime
                  length={movie.metadata?.runtime ? movie.metadata.runtime * 60000 : 0}
                  metadata={movie.metadata}
                  videoURL={movie.videoURL}
                />
              </p>
              {movie.metadata?.release_date ? (
                <PageContentAnimatePresence
                  _key={index + '-Metadata2'}
                  variants={variants_height}
                  transition={{ type: 'linear', delay: 0.21, duration: 2 }}
                >
                  <p className="pointer-events-none mt-2 block text-sm font-medium text-gray-200 text-center">
                    {movie.metadata.release_date}
                  </p>
                </PageContentAnimatePresence>
              ) : null}
              <PageContentAnimatePresence
                _key={index + '-Metadata3'}
                variants={variants_height}
                transition={{ type: 'linear', delay: 0.75, duration: 2 }}
              >
                <span className="pointer-events-none mt-2 block truncate text-sm font-medium text-white">
                  <span className="underline">{movie.title}</span>{' '}
                  {movie?.captionURLs ? <CaptionSVG /> : ''}
                </span>
              </PageContentAnimatePresence>
              {movie.metadata?.overview ? (
                <PageContentAnimatePresence
                  _key={index + '-Metadata4'}
                  variants={variants_height}
                  transition={{ type: 'linear', delay: 0.75, duration: 2 }}
                >
                  <p className="pointer-events-none mt-2 block text-sm font-medium text-gray-100">
                    {movie.metadata.overview}
                  </p>
                </PageContentAnimatePresence>
              ) : null}
            </Link>
          </PageContentAnimatePresence>
        </li>
      ))}
    </>
  )
}

const getAndUpdateMongoDB = cache(async (latestUpdateTimestamp) => {
  const client = await clientPromise

  const movies = await client
    .db('Media')
    .collection('Movies')
    .find(
      {},
      {
        projection: {
          title: 1,
          posterURL: 1,
          posterBlurhash: 1,
          videoURL: 1,
          length: 1,
          dimensions: 1,
          captionURLs: 1,
          posterBlurhashSource: 1,
          hdr: 1,
          'metadata.genres': 1,
          'metadata.overview': 1,
          'metadata.release_date': 1,
          'metadata.runtime': 1,
          'metadata.poster_path': 1,
        },
      }
    )
    .sort({ title: 1 })
    .toArray()
  movies.sort((a, b) => {
    const dateA = a.metadata?.release_date
    const dateB = b.metadata?.release_date

    // Sorting in descending order
    return dateB - dateA
  })

  // Convert MongoDB objects to plain JavaScript objects
  const plainMovies = await Promise.all(
    movies.map(async (movie) => {
      const returnObject = {
        _id: movie._id.toString(), // Convert ObjectId to string
        title: movie.title,
        videoURL: movie.videoURL,
        metadata: movie.metadata,
        dimensions: movie.dimensions,
        length: movie.length,
      }
      if (movie.metadata?.release_date) {
        if(typeof movie.metadata?.release_date?.toLocaleDateString === 'function') {
          returnObject.metadata.release_date = movie.metadata.release_date.toLocaleDateString()
        }
      }
      if (movie.metadata?.runtime <= 0) {
        returnObject.metadata.runtime = movie.length
      }

      if (movie.captionURLs) {
        returnObject.captionURLs = movie.captionURLs
      }

      if (movie.posterURL) {
        returnObject.posterURL = movie.posterURL
      }

      if (movie.posterBlurhash) {
      // Attach the promise; once it resolves, you'll get the blurhash base64 string.
      returnObject.posterBlurhashPromise = fetchMetadataMultiServer(
        movie.posterBlurhashSource,
        movie.posterBlurhash,
        'blurhash',
        'movie',
        movie.title
      );
    }


      if (movie.hdr) {
        returnObject.hdr = movie.hdr
      }

      return returnObject
    })
  )

  return plainMovies
})

export default memo(MovieList)
