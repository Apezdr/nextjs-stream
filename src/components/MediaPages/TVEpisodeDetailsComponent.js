import { classNames } from '@src/utils'
import Link from 'next/link'
import { Suspense } from 'react'
import ViewCount from './ViewCount'
import Image from 'next/image'
import dynamic from 'next/dynamic'
import RetryImage from '@components/RetryImage'
import WatchlistButton from '@components/WatchlistButton'

// Lazy load the cast grid section which can be heavy
const CastSection = dynamic(() => 
  import('./CastSection').then(mod => ({ default: props => <mod.default {...props} /> })),
  { ssr: true, loading: () => <div className="p-4 relative h-[31rem] bg-white bg-opacity-80 rounded-lg animate-pulse" /> }
)

const TVEpisodeDetailsComponent = ({ media }) => {
  if (!media) {
    return <div className="text-center py-4">Loading...</div>
  }

  // If it's brand new or not updated from TMDB yet, it won't have metadata
  let air_date, genres, overview, runtime, tagline, trailer_url, name, guest_stars
  if (media.metadata) {
    air_date = media.metadata.air_date
    genres = media.metadata.genres
    overview = media.metadata.overview
    runtime = media.metadata.runtime
    tagline = media.metadata.tagline
    trailer_url = media.metadata.trailer_url
    name = media.metadata.name
    guest_stars = media.metadata.guest_stars
  }
  const { title, showTitle, backdrop, logo, hdr, episodeNumber, seasonNumber, cast, duration } = media

  const thumbnail = media.thumbnail
  const posterURL = media.posterURL

  let blurhash = null

  const convertToLocaleTime = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = Math.floor(minutes % 60);
    const seconds = Math.floor((minutes * 60) % 60);
    return `${hours}h ${remainingMinutes}m ${seconds}s`;
  }

  const calculatedRuntime = duration ? convertToLocaleTime(duration / 60000) : runtime ? convertToLocaleTime(runtime) : null;

  if (backdrop) {
    blurhash = media.backdropBlurhash
  } else if (thumbnail) {
    blurhash = media.thumbnailBlurhash
  } else if (posterURL) {
    blurhash = media.posterBlurhash
  }

  return (
    <div className="max-w-4xl mx-auto p-4">
      <div className="flex flex-col gap-2">
        <div>
          <div className="relative">
            <Suspense fallback={<div className="w-full h-64 bg-gray-700 animate-pulse rounded-lg shadow-md"></div>}>
              {blurhash ?
                <RetryImage
                  src={backdrop ?? thumbnail ?? posterURL ?? `/sorry-image-not-available-banner.jpg`}
                  alt={`${title} backdrop`}
                  quality={100}
                  width={1200}
                  height={256}
                  placeholder="blur"
                  blurDataURL={`data:image/png;base64,${blurhash}`}
                  className="w-full h-64 object-cover rounded-lg shadow-md"
                  priority={false}
                />
                :
                <RetryImage
                  src={backdrop ?? thumbnail ?? posterURL ?? `/sorry-image-not-available-banner.jpg`}
                  alt={`${title} backdrop`}
                  quality={100}
                  width={1200}
                  height={256}
                  placeholder="blur"
                  blurDataURL={`data:image/png;base64,${blurhash}`}
                  className="w-full h-64 object-cover rounded-lg shadow-md"
                  priority={false}
                />
              }
              {logo && (
                <div className="absolute top-4 left-4">
                  <RetryImage
                    src={logo}
                    alt={`${showTitle} logo`}
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
          <div className="mt-4">
            <Link href={`/list/tv/${encodeURIComponent(showTitle)}/${seasonNumber}`} className="self-center">
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
              <h1 className="text-3xl font-bold">{name ?? title}</h1>
              <strong>S{seasonNumber}E{episodeNumber}</strong>
              <Suspense fallback={null}>
                {media?.normalizedVideoId ? (
                  <ViewCount normalizedVideoId={media.normalizedVideoId} />
                ) : null}
              </Suspense>
            </div>
            <p className="text-gray-300 italic">{tagline}</p>
            {air_date ? (
              <p className="mt-2">
                <strong>Air Date:</strong> {new Date(air_date).toLocaleDateString()}
              </p>
            ):null}
            {genres ? (
              <p>
                <strong>Genres:</strong> {genres.map((genre) => genre.name).join(', ')}
              </p>
            ) : null}
            {calculatedRuntime ? (
              <p>
                <strong>Runtime:</strong> {calculatedRuntime}
              </p>
            ) : null}
            {overview ? (
              <p className="mt-4">
                <strong>Overview:</strong> {overview}
              </p>
            ) : null}
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
            href={`/list/tv/${encodeURIComponent(showTitle)}/${seasonNumber}/${episodeNumber}/play`}
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
          {/* Add show to watchlist button for episodes */}
          {showTitle && (
            <WatchlistButton
              mediaId={media.showMediaId}
              tmdbId={media.showTmdbId}
              mediaType="tv"
              title={showTitle}
              className="h-12 mt-4 px-4 py-2 rounded-md"
            />
          )}
          </div>
        </div>
        {(cast && cast.length || guest_stars && guest_stars.length) ? (
            <hr className="my-8 border-gray-300" />
        ) : null}
        <div className='flex flex-col gap-8'>
          {guest_stars && guest_stars.length > 0 ? (
            <Suspense fallback={<div className="p-4 relative h-[31rem] bg-white bg-opacity-80 rounded-lg animate-pulse"></div>}>
              <CastSection cast={guest_stars} title="Guest Stars" />
            </Suspense>
          ): null}
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

export default TVEpisodeDetailsComponent
