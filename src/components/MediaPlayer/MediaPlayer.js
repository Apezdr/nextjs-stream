import '@vidstack/react/player/styles/default/theme.css'
//import '@vidstack/react/player/styles/default/layouts/video.css'
import './Layouts/video-layout.module.css'
import './Layouts/menus.css'
import './Layouts/sliders.css'

import { MediaPlayer, MediaProvider, Track } from '@vidstack/react'
import WithPlaybackTracker from '../built-in/WithPlaybackTracker'
import { VideoLayout } from './Layouts/video-layout'
import MediaPoster from './MediaPoster'
import { buildURL, getFullImageUrl } from '@src/utils'
import { onProviderChange, onProviderSetup } from './clientSide'
import { Inconsolata } from 'next/font/google'
import Media_Poster from '../MediaPoster'
import VolumeRegulator from './VolumeRegulator'
import { getServer } from '@src/utils/config'
import { Suspense } from 'react'
import WithPlaybackCoordinator from '@components/built-in/WithPlaybackCoordinator'

const inconsolata = Inconsolata({ subsets: ['latin'] })

async function validateVideoURL(url, updateValidationStatus = null) {
  try {
    const response = await fetch(url, { method: 'HEAD' })
    const isValid = response.ok
    
    // If validation fails and we have a callback, update the validation status
    if (!isValid && updateValidationStatus) {
      try {
        await updateValidationStatus(url, false)
      } catch (error) {
        console.error('Failed to update validation status:', error)
      }
    }
    
    return isValid
  } catch (error) {
    // If validation fails and we have a callback, update the validation status
    if (updateValidationStatus) {
      try {
        await updateValidationStatus(url, false)
      } catch (error) {
        console.error('Failed to update validation status:', error)
      }
    }
    return false
  }
}

async function VideoPlayer({
  media,
  mediaTitle,
  mediaType,
  goBack,
  searchParams = { clipStartTime: false, clipEndTime: false, start: false },
  shouldValidateURL = true,
  session,
}) {
  const { videoURL, metadata } = media

  // Function to update validation status in PlaybackStatus
  const updateValidationStatus = async (videoId, isValid) => {
    try {
      const response = await fetch('/api/authenticated/sync/updateValidationStatus', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          videoId,
          isValid
        })
      })
      
      if (!response.ok) {
        console.error('Failed to update validation status:', response.statusText)
      }
    } catch (error) {
      console.error('Error updating validation status:', error)
    }
  }

  const isValidVideoURL = shouldValidateURL ? await validateVideoURL(videoURL, updateValidationStatus) : true
  if (!isValidVideoURL) {
    return (
      <div className="w-96">
        {media?.posterURL ? (
          <Suspense><Media_Poster contClassName="relative" media={media} alt={media.title} /></Suspense>
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

  // clipStartTime and clipEndTime are optional query parameters
  // that can be used to specify a time range for the video playback
  // start is the time in seconds to start playback in the video
  let { clipStartTime, clipEndTime, start = null } = searchParams

  if (clipStartTime) {
    clipStartTime = parseInt(clipStartTime)
  }
  if (clipEndTime) {
    clipEndTime = parseInt(clipEndTime)
  }
  // Adjust metadata keys based on mediaType
  let title, released, overview, actors, episode_number, season_number, rating
  //
  let hasNextEpisode, nextEpisodeThumbnail, nextEpisodeThumbnailBlurhash, nextEpisodeTitle, nextEpisodeNumber
  //
  let hasCaptions = media?.captionURLs ? true : false
  let hasChapters = media?.chapterURL ? true : false
  // video details
  let mediaLength
  // thumbnail url
  let thumbnailURL
  //
  let chapterThumbnailURL

  let mediaMetadata, poster, logo, chapters
  //
  let hdr = false

  // Access the server configuration using the media's videoSource
  const serverConfig = getServer(media?.videoSource || media?.videoInfoSource || 'default')

  // Extract the Node.js server URL (syncEndpoint) from the server configuration
  const nodeServerUrl = serverConfig.syncEndpoint

  if (metadata && mediaType === 'tv') {
    title = metadata.name || metadata.title || media.title // Use 'name' for TV show episodes, 'title' for general metadata
    released = metadata.air_date // Use 'air_date' for TV show episodes
    overview = metadata.overview // Use 'overview' for TV show episodes
    episode_number = metadata.episode_number ?? media?.episodeNumber
    season_number = metadata.season_number ?? media?.seasonNumber
    hasNextEpisode = media.hasNextEpisode
    nextEpisodeThumbnail = media.nextEpisodeThumbnail
    nextEpisodeThumbnailBlurhash = media.nextEpisodeThumbnailBlurhash
    nextEpisodeTitle = media.nextEpisodeTitle
    nextEpisodeNumber = media.nextEpisodeNumber
    mediaLength = media.duration
    poster = metadata.high_quality_poster
    if (media.logo) {
      logo = media.logo
    }
    if (metadata.rating) {
      rating = metadata.rating
    }
    if (media.chapterURL) {
      chapters = `/api/authenticated/chapter?name=${encodeURIComponent(
        mediaTitle
      )}&type=${mediaType}&season=${season_number}&episode=${episode_number}`
      chapterThumbnailURL = `${nodeServerUrl}/frame/tv/${encodeURIComponent(
        media.originalTitle ?? mediaTitle
      )}/${season_number}/${episode_number}/`
    }
    thumbnailURL = `/api/authenticated/thumbnails?name=${encodeURIComponent(
      mediaTitle
    )}&type=${mediaType}&season=${season_number}&episode=${episode_number}`
    if (media.hdr) {
      hdr = media.hdr
    }

    mediaMetadata = {
      mediaTitle,
      title,
      released,
      overview,
      episode_number,
      season_number,
      hasNextEpisode,
      nextEpisodeThumbnail,
      nextEpisodeThumbnailBlurhash,
      nextEpisodeTitle,
      nextEpisodeNumber,
      mediaLength,
      rating,
    }
  } else if (metadata && mediaType === 'movie') {
    // Fallback for movies or other media types
    title = metadata.title
    released =
      metadata?.release_date &&
      metadata?.release_date instanceof Date &&
      metadata?.release_date === ''
        ? 'N/A'
        : metadata.release_date?.toLocaleDateString()
    overview = metadata.overview
    mediaLength = media.duration
    poster = media.posterURL ?? getFullImageUrl(metadata.poster_path)
    if (media.logo) {
      logo = media.logo
    } else if (media.metadata.logo_path) {
      logo = getFullImageUrl(media.metadata.logo_path)
    }
    if (metadata.rating) {
      rating = metadata.rating
    }
    if (media.chapterURL) {
      chapters = buildURL(`/api/authenticated/chapter?name=${encodeURIComponent(
        mediaTitle
      )}&type=${mediaType}`)
      chapterThumbnailURL = `${nodeServerUrl}/frame/movie/${encodeURIComponent(mediaTitle)}/`
    }
    thumbnailURL = buildURL(`/api/authenticated/thumbnails?name=${encodeURIComponent(
      mediaTitle
    )}&type=${mediaType}`)
    if (media.hdr) {
      hdr = media.hdr
    }
    mediaMetadata = {
      mediaTitle,
      title,
      released,
      overview,
      mediaLength,
      rating,
    }
  }

  const mediaPlayerTitleLabel = `${decodeURIComponent(mediaTitle ?? '')} ${
    season_number ? `Season ${season_number} ` : ''
  }${episode_number ? `- Episode ${episode_number} - ` : ''}${
    mediaType !== 'movie' ? (title ?? '') : ''
  }`

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
    <Suspense fallback={<div>Loading...</div>}>
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
        load="eager"
        aspectRatio="16/9"
        fullscreenOrientation="landscape"
        className="max-h-screen dark z-10"
        clipStartTime={clipStartTime}
        clipEndTime={clipEndTime}
        googleCast={{
          receiverApplicationId: process.env.CHROMECAST_RECEIVER_ID || undefined,
          resumeSavedSession: true,
        }}
      >
        <MediaProvider>
          <VolumeRegulator />
          {poster ? <MediaPoster poster={poster} title={title} /> : null}
          {videoURL ? <Suspense><WithPlaybackTracker videoURL={videoURL} start={start} /></Suspense> : null}
          <Suspense fallback={null}><WithPlaybackCoordinator /></Suspense>
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
                    default={language.indexOf('English') > -1}
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
            nextEpisodeThumbnailBlurhash: nextEpisodeThumbnailBlurhash,
            nextEpisodeTitle: nextEpisodeTitle,
            hasNextEpisode: hasNextEpisode,
            mediaLength: mediaLength,
          }}
          chapterThumbnailURL={chapterThumbnailURL}
          hdrVal={hdr}
          dimsVal={media.dimensions}
        />
      </MediaPlayer>
    </Suspense>
  )
}

export default VideoPlayer
