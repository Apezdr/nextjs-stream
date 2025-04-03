import PageContentAnimatePresence from '@components/HOC/PageContentAnimatePresence'
import MediaPoster from '@components/MediaPoster'
import { CaptionSVG } from '@components/SVGIcons'
import { TotalRuntime } from '@components/watched'
import Link from 'next/link'
import { memo, Suspense } from 'react'
import SkeletonCard from '@components/SkeletonCard'
import { getFlatPosters } from '@src/utils/flatDatabaseUtils'

const variants = {
  hidden: { opacity: 0, x: 0, y: -20 },
  enter: { opacity: 1, x: 0, y: 0 },
}
const variants_height = {
  hidden: { opacity: 0 },
  enter: { opacity: 1 },
}

const MovieList = async () => {
  // Define the custom projection needed for this component
  const customProjection = {
    length: 1,
    dimensions: 1,
    captionURLs: 1,
    // 'metadata.genres': 1, // Not directly used in JSX, omit for now
  };

  let movieList = await getFlatPosters('movie', false, 1, 0, customProjection)

  // Sort the movie list
  movieList.sort((a, b) => {
    const dateA = a.metadata?.release_date ? new Date(a.metadata.release_date) : null;
    const dateB = b.metadata?.release_date ? new Date(b.metadata.release_date) : null;

    if (dateA && dateB) {
      // Both have dates, sort descending (newest first)
      return dateB - dateA;
    } else if (dateA) {
      // Only A has a date, A comes first
      return -1;
    } else if (dateB) {
      // Only B has a date, B comes first
      return 1;
    } else {
      // Neither has a date, sort alphabetically by title
      return a.title.localeCompare(b.title);
    }
  });

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
                    {typeof movie.metadata.release_date.toLocaleDateString === 'function'
                      ? movie.metadata.release_date.toLocaleDateString()
                      : String(movie.metadata.release_date)}
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

export default memo(MovieList)
