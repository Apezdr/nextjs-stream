import { classNames, getFullImageUrl } from '@src/utils'
import Link from 'next/link'
import Image from 'next/image'
import { Suspense } from 'react'
import ViewCount from './ViewCount'
import dynamic from 'next/dynamic'
import RetryImage from '@components/RetryImage'
import WatchlistButton from '@components/WatchlistButton'

// Lazy load the cast grid section which can be heavy
const CastSection = dynamic(() => 
  import('./CastSection').then(mod => ({ default: props => <mod.default {...props} /> })),
  { ssr: true, loading: () => <div className="p-4 relative h-[31rem] bg-white bg-opacity-80 rounded-lg animate-pulse" /> }
)

const MovieDetailsComponent = ({ media }) => {
  if (!media) {
    return <div className="text-center py-4">Loading...</div>
  }

  const { title, backdrop, posterURL, logo, metadata, hdr, duration,  } = media
  const { release_date, genres, cast, overview, runtime, tagline, trailer_url } = metadata
  const collectionData = metadata?.belongs_to_collection

  const convertToLocaleTime = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = Math.floor(minutes % 60);
    const seconds = Math.floor((minutes * 60) % 60);
    return `${hours}h ${remainingMinutes}m ${seconds}s`;
  }
  
  // Separate blurhash handling for poster and backdrop
  const posterBlurhash = media.posterBlurhash
  const backdropBlurhash = media.backdropBlurhash || media.posterBlurhash // fallback to poster blurhash

  const calculatedRuntime = duration ? convertToLocaleTime(duration / 60000) : runtime ? convertToLocaleTime(runtime) : null;

  return (
    <div className="max-w-4xl mx-auto p-4">
      <div className="flex flex-col gap-2">
        <div>
          <div className="flex gap-4 h-64">
            {/* Poster on the left */}
            <div className="flex-shrink-0">
              <Suspense fallback={<div className="w-40 h-64 bg-gray-700 animate-pulse rounded-lg shadow-md"></div>}>
                {posterBlurhash ? (
                  <RetryImage
                    src={posterURL ?? `/sorry-image-not-available.jpg`}
                    alt={`${title} poster`}
                    quality={100}
                    width={160}
                    height={256}
                    placeholder="blur"
                    blurDataURL={`data:image/png;base64,${posterBlurhash}`}
                    className="w-40 h-64 object-cover rounded-lg shadow-md"
                    priority={false}
                  />
                ) : (
                  <RetryImage
                    src={posterURL ?? `/sorry-image-not-available.jpg`}
                    alt={`${title} poster`}
                    quality={100}
                    width={160}
                    height={256}
                    className="w-40 h-64 object-cover rounded-lg shadow-md"
                    priority={false}
                  />
                )}
              </Suspense>
            </div>
            
            {/* Backdrop on the right */}
            <div className="flex-grow relative">
              <Suspense fallback={<div className="w-full h-64 bg-gray-700 animate-pulse rounded-lg shadow-md"></div>}>
                {backdropBlurhash ? (
                  <RetryImage
                    src={backdrop ?? posterURL ?? `/sorry-image-not-available-banner.jpg`}
                    alt={`${title} backdrop`}
                    quality={100}
                    width={1200}
                    height={256}
                    placeholder="blur"
                    blurDataURL={`data:image/png;base64,${backdropBlurhash}`}
                    className="w-full h-64 object-cover rounded-lg shadow-md"
                    priority={false}
                  />
                ) : (
                  <RetryImage
                    src={backdrop ?? posterURL ?? `/sorry-image-not-available-banner.jpg`}
                    alt={`${title} backdrop`}
                    quality={100}
                    width={1200}
                    height={256}
                    className="w-full h-64 object-cover rounded-lg shadow-md"
                    priority={false}
                  />
                )}
                {logo && (
                  <div className="absolute top-4 left-4">
                    <RetryImage
                      src={logo}
                      alt={`${title} logo`}
                      quality={100}
                      width={128}
                      height={40}
                      className="w-32 h-auto"
                      priority={true}
                    />
                  </div>
                )}
              </Suspense>
            </div>
          </div>
          <div className="mt-4">
            <Link href="/list/movie" className="self-center">
              <button
                type="button"
                className="flex flex-row gap-x-2 rounded bg-indigo-600 px-2 py-1 text-base font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 mx-auto"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-6 h-6"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
                  />
                </svg>
                Go Back
              </button>
            </Link>
            <div className="flex flex-row w-full gap-2">
              {title ? <h1 className="text-3xl font-bold">{title}</h1> : null}
              <Suspense fallback={null}>
                {media?.normalizedVideoId ? (
                  <ViewCount normalizedVideoId={media.normalizedVideoId} />
                ) : null}
              </Suspense>
            </div>
            {tagline ? <p className="text-gray-300 italic">{tagline}</p> : null}
            {release_date ? (
              <p className="mt-2">
                <strong>Release Date:</strong> {new Date(release_date).toLocaleDateString()}
              </p>
            ):null}
            {genres && genres.length > 0 ? (
              <p>
                <strong>Genres:</strong> {genres.map((genre) => genre.name).join(', ')}
              </p>
            ):null}
            {calculatedRuntime ? (
              <p>
                <strong>Runtime:</strong> {calculatedRuntime}
              </p>
            ):null}
            {overview ? (
              <p className="mt-4">
                <strong>Overview:</strong> {overview}
              </p>
            ):null}
          </div>
          {/* <div className="mt-6">
                        <h2 className="text-2xl font-semibold">Cast</h2>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
                            {cast.map(member => (
                                <div key={member.id} className="flex flex-col items-center">
                                    <img src={member.profile_path} alt={member.name} className="w-24 h-24 object-cover rounded-full shadow-md" />
                                    <p className="mt-2 text-center">{member.name}</p>
                                    <p className="text-sm text-gray-500">{member.character}</p>
                                </div>
                            ))}
                        </div>
                    </div> */}
          <div className='flex flex-row justify-evenly'>
          <Link
            href={`/list/movie/${title}/play`}
            className={classNames(
              'relative inline-flex flex-row items-center gap-2',
              'opacity-80 hover:opacity-100 bg-slate-500 hover:bg-slate-600 text-white font-bold rounded-md px-4 py-2 mt-4'
            )}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="w-5 h-5"
            >
              <path
                fillRule="evenodd"
                d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z"
                clipRule="evenodd"
              />
            </svg>
            <span>Watch Now {hdr ? `in ${hdr}` : null}</span>
          </Link>
          {trailer_url ? (
          <Link
            href={trailer_url}
            target={'_blank'}
            className="h-12 mt-4 px-6 py-2 text-slate-200 hover:text-white bg-blue-700 rounded-full hover:bg-blue-800 transition flex items-center gap-2"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 28.57 20"
              className="size-6 inline"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28.57 20">
                <path
                  fill="red"
                  d="M27.973 3.123A3.578 3.578 0 0 0 25.447.597C23.22 0 14.285 0 14.285 0S5.35 0 3.123.597A3.578 3.578 0 0 0 .597 3.123C0 5.35 0 10 0 10s0 4.65.597 6.877a3.578 3.578 0 0 0 2.526 2.526C5.35 20 14.285 20 14.285 20s8.935 0 11.162-.597a3.578 3.578 0 0 0 2.526-2.526C28.57 14.65 28.57 10 28.57 10s-.002-4.65-.597-6.877Z"
                />
                <path fill="#fff" d="M11.425 14.285 18.848 10l-7.423-4.285v8.57Z" />
              </svg>
            </svg>
            Trailer
          </Link>
          ) : null}
          {/* Add movie to watchlist button */}
          {media && (
            <WatchlistButton
              mediaId={media.id}
              tmdbId={media.metadata?.id}
              mediaType="movie"
              title={title}
              className="h-12 mt-4 px-4 py-2 rounded-md"
            />
          )}
          </div>
        </div>
        {collectionData || cast && cast.length > 0 ? (
            <hr className="my-8 border-gray-300" />
        ) : null}
        <div className='flex flex-col gap-8'>
          {collectionData ? (
            <div>
              <h2 className="text-2xl font-semibold mb-6">Collection</h2>
              <div className="flex justify-center">
                <div className="group relative max-w-xs">
                  <Link
                    href={`/list/collection/${collectionData.id}`}
                    className="block"
                  >
                    <div className="relative rounded-xl overflow-hidden transition-all duration-500 transform group-hover:scale-105 group-hover:z-10">
                      {/* Enhanced Shadow */}
                      <div className="absolute inset-0 rounded-xl transition-all duration-500 pointer-events-none shadow-lg shadow-black/50 group-hover:shadow-2xl group-hover:shadow-indigo-500/20" />
                      
                      {/* Poster Container */}
                      <div className="aspect-[2/3] relative bg-gray-900 w-48">
                        {/* Poster Image */}
                        <Image
                          src={getFullImageUrl(collectionData.poster_path) || '/sorry-image-not-available.jpg'}
                          alt={collectionData.name}
                          fill
                          className="object-cover transition-all duration-700"
                          sizes="192px"
                        />
                        
                        {/* Gradient Overlays */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-90" />
                        
                        {/* Collection Badge */}
                        <div className="absolute top-3 right-3">
                          <div className="bg-indigo-600/90 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-full font-medium flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                            </svg>
                            Collection
                          </div>
                        </div>
                        
                        {/* Collection Title */}
                        <div className="absolute bottom-0 left-0 right-0 p-4">
                          <h3 className="font-bold text-white text-lg mb-1 line-clamp-2 drop-shadow-lg text-center">
                            {collectionData.name}
                          </h3>
                        </div>
                        
                        {/* Hover Overlay Background */}
                        <div className="absolute inset-0 bg-gradient-to-t from-indigo-900/90 via-indigo-900/50 to-transparent transition-opacity duration-300 pointer-events-none opacity-0 group-hover:opacity-100" />
                        
                        {/* Hover Action Button */}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="transition-opacity duration-300 opacity-0 group-hover:opacity-100 pointer-events-auto w-[80%]">
                            <div className="bg-white/20 backdrop-blur-sm text-white px-6 py-3 rounded-full font-medium flex items-center gap-2 transform transition-transform duration-300 group-hover:scale-110">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                              View Collection
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Link>
                </div>
              </div>
            </div>
          ) : null}
          {cast && cast.length > 0 ? (
            <Suspense fallback={<div className="p-4 relative h-[31rem] bg-white bg-opacity-80 rounded-lg animate-pulse"></div>}>
              <CastSection cast={cast} />
            </Suspense>
          ): null}
        </div>
      </div>
    </div>
  )
}

export default MovieDetailsComponent
