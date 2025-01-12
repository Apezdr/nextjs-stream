import MediaPoster from '@components/MediaPoster'
import HD4kBanner from '../../../public/4kBanner.png'
import hdr10PlusLogo from '../../../public/HDR10+_Logo_light.svg'
import Image from 'next/image'
import { classNames, generateColors, getFullImageUrl, getResolutionLabel } from '@src/utils'
import RetryImage from '@components/RetryImage'

export default function Detailed({
  tvShow,
  posterOnly = false,
  size = { w: 600, h: 600 },
  contClassName = 'w-max',
  contClassNamePoster = 'max-w-sm',
  quality = 100,
  metaStatusClasses = 'font-bold text-xs',
  networkQuality = 100,
  networkClasses = 'w-auto h-4 inset-0 mx-auto',
  networkContainerClasses = 'w-full inset-0 flex flex-col py-3',
  hideGenres = true,
  check4kandHDR = false,
  imagePriority = false,
  loadingType = undefined,
}) {
  let networkName = tvShow.metadata?.networks[0]?.name
  let networkImage = getFullImageUrl(tvShow.metadata?.networks[0]?.logo_path, 'w185')
  const totalEpisodes = tvShow.seasons.reduce((total, season) => {
    return total + (season.episodes ? season.episodes.length : 0)
  }, 0)

  let has4k, hasHDR, hasHDR10
  if (check4kandHDR) {
    has4k = tvShow.seasons.some((season) =>
      season.episodes.every(
        (episode) => getResolutionLabel(episode?.dimensions).is4k
      )
    )
    
    hasHDR = tvShow.seasons.some((season) =>
      season.episodes.every((episode) => episode?.hdr)
    )
    
    hasHDR10 = tvShow.seasons.some((season) =>
      season.episodes.every((episode) => episode?.hdr === 'HDR10')
    )
  }
  return (
    <>
      <div
        className={classNames(
          contClassName,
          'select-none group-hover:scale-105 group-hover:mb-8 transition-all relative block mx-auto overflow-hidden rounded-lg focus-within:ring-2 focus-within:ring-indigo-500 focus-within:ring-offset-2 focus-within:ring-offset-gray-100 shadow-xl'
        )}
      >
        <div className="w-full inset-0 flex flex-col bg-gray-300 group-hover:bg-gray-600">
          <span
            className={classNames(
              'w-full h-6 text-center bg-gray-700 group-hover:bg-gray-600 text-gray-300 group-hover:text-gray-200 mx-auto inline-flex items-center justify-center',
              metaStatusClasses
            )}
          >
            {tvShow.metadata?.status ? (
              <>
                {tvShow.metadata.status === 'Returning Series' ? (
                  // Clock icon
                  <svg
                    className="w-2.5 h-2.5 me-1.5"
                    aria-hidden="true"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M10 0a10 10 0 1 0 10 10A10.011 10.011 0 0 0 10 0Zm3.982 13.982a1 1 0 0 1-1.414 0l-3.274-3.274A1.012 1.012 0 0 1 9 10V6a1 1 0 0 1 2 0v3.586l2.982 2.982a1 1 0 0 1 0 1.414Z" />
                  </svg>
                ) : (
                  // Ended
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="red"
                    className="w-3 h-3 me-1"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636"
                    />
                  </svg>
                )}
                {tvShow.metadata.status}
              </>
            ) : (
              ''
            )}
          </span>
        </div>
        <MediaPoster
          tv={tvShow}
          size={size}
          quality={quality}
          hideGenres={hideGenres}
          imagePriority={imagePriority}
          loadingType={loadingType}
          contClassName={contClassNamePoster}
        />
        <div
          className={classNames(
            networkContainerClasses,
            networkName === 'Netflix'
              ? 'bg-black'
              : networkName === 'HBO'
                ? 'bg-blue-400'
                : // default
                  'bg-gradient-to-bl from-gray-400 via-gray-200 to-gray-100'
          )}
        >
          {networkImage ? (
            <RetryImage
              src={networkImage}
              width={96}
              height={16}
              alt={networkName}
              quality={networkQuality}
              className={networkClasses}
              priority
            />
          ) : null}
        </div>
      </div>
      {posterOnly ? null : (
        <>
          <div className="mt-2 text-center text-gray-200 text-lg font-bold transition-all delay-150 duration-500">
            <span>{tvShow.title}</span>
          </div>
          <div
            className={classNames(
              'mt-2 text-center text-sm font-medium text-gray-300 group-hover:text-white'
            )}
          >
            <div className="flex flex-row justify-center">
              {tvShow.metadata?.genres.map((genre, index) => {
                const { fontColor, backgroundColor } = generateColors(genre?.name)
                return (
                  <span
                    key={genre.name}
                    className="text-xs font-medium me-2 px-2.5 rounded border border-gray-600"
                    style={{ backgroundColor: backgroundColor, color: fontColor }}
                  >
                    {genre.name}
                  </span>
                )
              })}
            </div>
          </div>
          <div
            className={classNames(
              'mt-2 text-center text-sm font-medium text-gray-300 group-hover:text-white flex flex-col'
            )}
          >
            {tvShow.metadata?.tagline ? (
              <SeasonCount seasons={tvShow.seasons} metadata={tvShow.metadata} />
            ) : null}
            {tvShow.metadata?.tagline ? <EpisodeCount totalEpisodes={totalEpisodes} /> : null}
            <ShowMetadata
              metadata={tvShow.metadata}
              totalEpisodes={totalEpisodes}
              tvShow={tvShow}
            />
          </div>
          <div className="mt-2 text-center text-sm font-medium text-gray-300 group-hover:text-white pt-2 border-t border-solid border-t-[#c1c1c133]">
          {check4kandHDR && (has4k || hasHDR) && (
              <>
                <div className="flex flex-row gap-3 justify-center mb-2">
                  {has4k && (
                    <div className="select-none bg-transparent h-4">
                      <RetryImage
                        src={HD4kBanner}
                        className="h-4 w-auto"
                        alt="4K Banner"
                        loading="lazy"
                        placeholder="blur"
                      />
                    </div>
                  )}
                  {hasHDR && (
                    <>
                      {hasHDR10 ? (
                        <RetryImage
                          src={hdr10PlusLogo}
                          alt="HDR10 Logo"
                          className="h-4 w-auto"
                          priority
                        />
                        // add additional HDR handling here if needed
                      ) : null}
                    </>
                  )}
                </div>
                <hr className="mb-2 border-[#c1c1c133] w-full" />
              </>
            )}
            <span className="">{tvShow.metadata?.overview}</span>
          </div>
        </>
      )}
    </>
  )
}

const SeasonCount = ({ seasons, metadata }) => {
  const validSeasonsCount = seasons.filter((season) => season.seasonNumber !== 0).length
  const totalSeasonsCount = metadata?.seasons.filter(
    (season) => season.season_number !== 0 && season.episode_count > 0
  ).length

  return (
    <span className="text-base">
      {validSeasonsCount} Season{validSeasonsCount > 1 ? 's' : ''}
      {validSeasonsCount === totalSeasonsCount ? '' : ` of ${totalSeasonsCount}`}
    </span>
  )
}
const EpisodeCount = ({ totalEpisodes }) => {
  return totalEpisodes ? <span className="text-xs">{totalEpisodes} Episodes</span> : null
}
const ShowMetadata = ({ metadata, totalEpisodes, tvShow }) => {
  return (
    <div className="grid grid-cols-3 text-center mt-4">
      <span className="block">
        {metadata?.first_air_date && (
          <div className="flex flex-col">
            <strong className="underline">Released</strong>
            <span>{new Date(metadata?.first_air_date).toLocaleDateString()}</span>
          </div>
        )}
      </span>
      <span className="block">
        {metadata?.tagline ? (
          <div className="flex flex-col h-full justify-center">
            <span className="text-xs italic text-white">“{metadata?.tagline}”</span>
          </div>
        ) : (
          <div className="flex flex-col">
            <SeasonCount seasons={tvShow.seasons} metadata={tvShow.metadata} />
            <EpisodeCount totalEpisodes={totalEpisodes} />
          </div>
        )}
      </span>
      <span className="block">
        {metadata?.last_air_date && (
          <div className="flex flex-col">
            <strong className="underline">Last Episode</strong>
            <span>{new Date(metadata?.last_air_date).toLocaleDateString()}</span>
          </div>
        )}
      </span>
    </div>
  )
}
