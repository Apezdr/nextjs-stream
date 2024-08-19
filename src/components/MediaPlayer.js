import '@vidstack/react/player/styles/default/theme.css'
import '@vidstack/react/player/styles/default/layouts/video.css'

import { MediaPlayer, MediaProvider, Track } from '@vidstack/react'
import WithPlaybackTracker from './built-in/WithPlaybackTracker'
import { VideoLayout } from './MediaPlayer/Layouts/video-layout'
import { MediaPoster as vidStackPoster } from './MediaPlayer/MediaPoster'
import { buildURL, getFullImageUrl } from 'src/utils'
import { onProviderChange, onProviderSetup } from './MediaPlayer/clientSide'
import { Inconsolata } from 'next/font/google'
import Image from 'next/image'
import MediaPoster from './MediaPoster'
const inconsolata = Inconsolata({ subsets: ['latin'] })

async function validateVideoURL(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' })
    return response.ok
  } catch (error) {
    return false
  }
}

async function VideoPlayer({
  media,
  mediaTitle,
  mediaType,
  goBack,
  searchParams = { clipStartTime: false, clipEndTime: false },
}) {
  const { videoURL, metadata } = media

  const isValidVideoURL = await validateVideoURL(videoURL)
  if (!isValidVideoURL) {
    return (
      <div className="w-96">
        {media?.posterURL ? (
          <MediaPoster contClassName="relative" media={media} alt={media.title} />
        ) : null}
        <div className="font-bold mt-4">Looks like we've got an error on our side:</div>
        <div>The video URL is invalid or unreachable.</div>
        {process.env.NODE_ENV === 'development' ? (
          <div className="error-box mt-4 p-4 border border-red-500 bg-red-100 text-red-700 rounded-lg">
            <span className="font-bold block text-sm uppercase underline">
              Encountered an Error
            </span>
            <div className="mt-4 text-xs">
              <span className="font-bold block">videoURL:</span>
              <div className="w-80 truncate">
                <span title={videoURL}>{videoURL}</span>
              </div>
            </div>
            <hr className="border-red-500 w-full mt-2" />
            <span className="mt-4 text-xs leading-normal">
              You may need to update this videoURL to match an actual file/url.
            </span>
          </div>
        ) : null}
      </div>
    )
  }

  let { clipStartTime, clipEndTime } = searchParams

  if (clipStartTime) {
    clipStartTime = parseInt(clipStartTime)
  }
  if (clipEndTime) {
    clipEndTime = parseInt(clipEndTime)
  }
  // Adjust metadata keys based on mediaType
  let title, released, overview, actors, episode_number, season_number
  //
  let hasNextEpisode, nextEpisodeThumbnail, nextEpisodeTitle, nextEpisodeNumber
  //
  let hasCaptions = media?.captionURLs ? true : false
  let hasChapters = media?.chapterURL ? true : false
  // video details
  let mediaLength
  // thumbnail url
  let thumbnailURL

  let mediaMetadata, poster, logo, chapters

  if (metadata && mediaType === 'tv') {
    title = metadata.name || metadata.title // Use 'name' for TV show episodes, 'title' for general metadata
    released = metadata.air_date // Use 'air_date' for TV show episodes
    overview = metadata.overview // Use 'overview' for TV show episodes
    episode_number = metadata.episode_number
    season_number = metadata.season_number
    hasNextEpisode = media.hasNextEpisode
    nextEpisodeThumbnail = media.nextEpisodeThumbnail
    nextEpisodeTitle = media.nextEpisodeTitle
    nextEpisodeNumber = media.nextEpisodeNumber
    mediaLength = media.length
    poster = metadata.high_quality_poster
    if (media.logo) {
      logo = media.logo
    }
    if (media.chapterURL) {
      chapters = `/api/authenticated/chapter?name=${encodeURIComponent(
        mediaTitle
      )}&type=${mediaType}&season=${season_number}&episode=${episode_number}`
    }
    thumbnailURL = `/api/authenticated/thumbnails?name=${encodeURIComponent(
      mediaTitle
    )}&type=${mediaType}&season=${season_number}&episode=${episode_number}`
    mediaMetadata = {
      mediaTitle,
      title,
      released,
      overview,
      episode_number,
      season_number,
      hasNextEpisode,
      nextEpisodeThumbnail,
      nextEpisodeTitle,
      nextEpisodeNumber,
      mediaLength,
    }
  } else if (metadata && mediaType === 'movie') {
    // Fallback for movies or other media types
    title = metadata.title
    released = metadata.release_date === '' ? 'N/A' : metadata.release_date?.toLocaleDateString()
    overview = metadata.overview
    mediaLength = media.length
    poster = media.posterURL ?? getFullImageUrl(metadata.poster_path)
    if (media.logo) {
      logo = media.logo
    }
    if (media.chapterURL) {
      chapters = `/api/authenticated/chapter?name=${encodeURIComponent(
        mediaTitle
      )}&type=${mediaType}`
    }
    thumbnailURL = `/api/authenticated/thumbnails?name=${encodeURIComponent(
      mediaTitle
    )}&type=${mediaType}`
    mediaMetadata = {
      mediaTitle,
      title,
      released,
      overview,
      mediaLength,
    }
  }

  const mediaPlayerTitleLabel = `${decodeURIComponent(mediaTitle)} ${
    season_number ? `Season ${season_number} ` : ''
  }${episode_number ? `- Episode ${episode_number} - ` : ''}${mediaType !== 'movie' ? title : ''}`

  let captions = media?.captionURLs ? media?.captionURLs : null

  if (captions) {
    const updatedCaptions = {}
    Object.entries(media.captionURLs).forEach(([language, captionObject]) => {
      let captionURL = ''
      if (mediaType === 'tv') {
        captionURL = `/api/authenticated/subtitles?name=${encodeURIComponent(
          mediaTitle
        )}&language=${language}&type=${mediaType}&season=${season_number}&episode=${episode_number}`
      } else {
        captionURL = `/api/authenticated/subtitles?name=${encodeURIComponent(
          media.title
        )}&language=${language}&type=${mediaType}`
      }
      updatedCaptions[language] = { ...captionObject, url: buildURL(captionURL) }
    })
    captions = updatedCaptions
  }

  return (
    <MediaPlayer
      title={mediaPlayerTitleLabel}
      src={videoURL}
      poster={poster}
      autoPlay={true}
      controlsDelay={6000}
      onProviderChange={onProviderChange}
      onProviderSetup={onProviderSetup}
      streamType="on-demand"
      playsInline
      load="idle"
      aspectRatio="16/9"
      fullscreenOrientation="landscape"
      className="max-h-screen"
      clipStartTime={clipStartTime}
      clipEndTime={clipEndTime}
      googleCast={{
        receiverApplicationId: process.env.CHROMECAST_RECEIVER_ID || undefined,
      }}
    >
      <MediaProvider>
        <vidStackPoster poster={poster} title={title} />
        <WithPlaybackTracker videoURL={videoURL} />
        {chapters ? <Track kind="chapters" src={chapters} lang="en-US" default /> : null}
        {captions
          ? Object.entries(captions).map(([language, captionObject], index) => {
              return (
                <Track
                  key={language + index}
                  src={captionObject.url}
                  kind="subtitles"
                  label={language}
                  lang={captionObject.srcLang}
                  default={index === 0}
                  className={inconsolata.className}
                />
              )
            })
          : null}
      </MediaProvider>
      <VideoLayout
        thumbnails={thumbnailURL}
        hasCaptions={hasCaptions}
        hasChapters={hasChapters}
        goBack={goBack}
        mediaMetadata={mediaMetadata}
        logo={logo}
        videoURL={videoURL}
        captions={captions}
        nextUpCard={{
          mediaTitle: mediaTitle,
          season_number: season_number,
          nextEpisodeNumber: nextEpisodeNumber,
          nextEpisodeThumbnail: nextEpisodeThumbnail,
          nextEpisodeTitle: nextEpisodeTitle,
          hasNextEpisode: hasNextEpisode,
          mediaLength: mediaLength,
        }}
      />
    </MediaPlayer>
  )
}

export default VideoPlayer
