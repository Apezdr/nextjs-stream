import VirtualizedCastGrid from '@components/MediaScroll/VirtualizedCastGrid'
import { classNames, getFullImageUrl } from '@src/utils'
import Link from 'next/link'

const MovieDetailsComponent = ({ media }) => {
  if (!media) {
    return <div className="text-center py-4">Loading...</div>
  }

  const { title, backdrop, logo, metadata, hdr } = media
  const { release_date, genres, cast, overview, runtime, tagline } = metadata
  const collectionData = metadata?.belongs_to_collection

  return (
    <div className="max-w-4xl mx-auto p-4">
      <div className="flex flex-col gap-2">
        <div>
          <div className="relative">
            <img
              src={backdrop}
              alt={`${title} backdrop`}
              className="w-full h-64 object-cover rounded-lg shadow-md"
            />
            {logo && (
              <div className="absolute top-4 left-4">
                <img src={logo} alt={`${title} logo`} className="w-32 h-auto" />
              </div>
            )}
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
            <h1 className="text-3xl font-bold">{title}</h1>
            <p className="text-gray-600 italic">{tagline}</p>
            <p className="mt-2">
              <strong>Release Date:</strong> {new Date(release_date).toLocaleDateString()}
            </p>
            <p>
              <strong>Genres:</strong> {genres.map((genre) => genre.name).join(', ')}
            </p>
            <p>
              <strong>Runtime:</strong> {runtime} minutes
            </p>
            <p className="mt-4">
              <strong>Overview:</strong> {overview}
            </p>
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
          <Link
            href={`/list/movie/${title}/play`}
            className={classNames(
              'relative inline-flex items-center gap-2',
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
            <span>Watch Now {hdr ? `in HDR10+` : null}</span>
          </Link>
        </div>
        {collectionData || cast ? (
            <hr className="my-8 border-gray-300" />
        ) : null}
        <div className='flex flex-col gap-8'>
          {collectionData ? (
            <div>
              <h2 className="text-2xl font-semibold">Collection</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
                <div key={collectionData.id} className="flex flex-col items-center">
                    <img
                        src={getFullImageUrl(collectionData.poster_path)}
                        alt={collectionData.name}
                        className="w-24 h-auto object-cover rounded-lg shadow-md"
                    />
                    <p className="mt-2 text-center">{collectionData.name}</p>
                </div>
              </div>
            </div>
          ) : null}
          {cast ? (
            <div className="p-4 relative h-[31rem] bg-white bg-opacity-80 rounded-lg"> {/* Ensure a fixed height for virtualization */}
                <h4 className="text-2xl text-black font-semibold mb-4">Cast</h4>
                <VirtualizedCastGrid cast={cast} />
            </div>
          ): null}
        </div>
      </div>
    </div>
  )
}

export default MovieDetailsComponent
