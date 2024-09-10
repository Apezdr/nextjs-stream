import PageContentAnimatePresence from '@components/HOC/PageContentAnimatePresence'
import MediaPoster from '@components/MediaPoster'
import { CaptionSVG } from '@components/SVGIcons'
import { TotalRuntime } from '@components/watched'
import Link from 'next/link'
import { cache, memo } from 'react'
import clientPromise from '@src/lib/mongodb'
import { fetchMetadata } from '@src/utils/admin_utils'

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
        <li key={movie.title} className="relative min-w-[250px]">
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
                <MediaPoster movie={movie} />
                <button type="button" className="absolute inset-0 focus:outline-none">
                  <span className="sr-only">View details for {movie.title}</span>
                </button>
              </div>
              <p className="pointer-events-none mt-2 block text-sm font-medium text-gray-200 text-center">
                <TotalRuntime
                  length={movie.length ?? movie.metadata.runtime * 60000 ?? 0}
                  metadata={movie.metadata}
                  videoURL={movie.videoURL}
                />
              </p>
              <PageContentAnimatePresence
                _key={index + '-Metadata2'}
                variants={variants_height}
                transition={{ type: 'linear', delay: 0.21, duration: 2 }}
              >
                <p className="pointer-events-none mt-2 block text-sm font-medium text-gray-200 text-center">
                  {movie.metadata.release_date}
                </p>
              </PageContentAnimatePresence>
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
              <PageContentAnimatePresence
                _key={index + '-Metadata4'}
                variants={variants_height}
                transition={{ type: 'linear', delay: 0.75, duration: 2 }}
              >
                <p className="pointer-events-none mt-2 block text-sm font-medium text-gray-100">
                  {movie.metadata.overview}
                </p>
              </PageContentAnimatePresence>
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
          'metadata.genres': 1,
          'metadata.overview': 1,
          'metadata.release_date': 1,
          'metadata.runtime': 1,
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
      if (movie.metadata.release_date) {
        returnObject.metadata.release_date = movie.metadata.release_date.toLocaleDateString()
      }
      if (movie.metadata.runtime <= 0) {
        returnObject.metadata.runtime = movie.length
      }

      if (movie.captionURLs) {
        returnObject.captionURLs = movie.captionURLs
      }

      if (movie.posterURL) {
        returnObject.posterURL = movie.posterURL
      }

      if (movie.posterBlurhash) {
        returnObject.posterBlurhash = await fetchMetadata(
          movie.posterBlurhash,
          'blurhash',
          'movie',
          movie.title
        )
      }

      return returnObject
    })
  )

  return plainMovies
})

export default memo(MovieList)
