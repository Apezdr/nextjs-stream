import MainVideoPlayer from './MainVideoPlayer'
import { buildURL, getFullImageUrl } from '@src/utils'
import { mintCastPlaybackToken } from '@src/lib/castPlaybackToken'
import { generateNormalizedVideoId } from '@src/utils/videoIdentity'
import Media_Poster from '../MediaPoster'
import { getServer } from '@src/utils/config'
import { Suspense } from 'react'

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
  // Preflight result computed by the parent view (MoviePlayerView /
  // TVEpisodePlayerView already HEAD the URL). When provided, this component
  // must NOT issue a second HEAD of its own.
  isValidVideoURL: preflightedIsValid = undefined,
  session,
  savedPlaybackTime = null,
  hasFullAccess = true,
}) {
  // Check if user is an admin
  const isAdmin = session?.user?.role === 'admin'
  const { videoURL, metadata } = media
  
  // Conditionally import the SubtitleEditor component only for admin users
  let SubtitleEditor = null;
  if (isAdmin) {
    try {
      const EditorModule = await import('@components/Admin/SubtitleEditor/SubtitleEditor');
      SubtitleEditor = EditorModule.default;
    } catch (error) {
      console.error('Error loading SubtitleEditor:', error);
    }
  }

  // Function to update validation status in WatchHistory
  const updateValidationStatus = async (videoId, isValid) => {
    try {
      const response = await fetch(buildURL('/api/authenticated/sync/updateValidationStatus'), {
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

  // Preflight precedence: (1) skip entirely for JIT manifests — a first-hit
  // master request may legitimately block on the transcoder's one-time
  // keyframe scan, and the serve layer already health-checked it; (2) reuse
  // the parent view's result instead of re-HEADing; (3) legacy self-check.
  const isManifestURL = /\.m3u8($|\?)/i.test(videoURL || '')
  const isValidVideoURL = isManifestURL
    ? true
    : typeof preflightedIsValid === 'boolean'
      ? preflightedIsValid
      : shouldValidateURL
        ? await validateVideoURL(videoURL, updateValidationStatus)
        : true
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

  // Filesystem/database key per the dual-title rule (originalTitle = folder
  // name on the file server); mediaTitle is only the route slug
  const lookupTitle = media?.originalTitle ?? media?.title ?? mediaTitle

  // Only provide captions to users with full access (approved and not limited)
  let captions = (hasFullAccess && media?.captionURLs) ? media?.captionURLs : null

  if (captions) {
    const updatedCaptions = {}
    Object.entries(media.captionURLs).forEach(([language, captionObject]) => {
      const autoSuffix = captionObject?.autoGenerated ? '&auto=true' : ''
      let captionURL = ''
      if (mediaType === 'tv') {
        captionURL = `/api/authenticated/subtitles?name=${encodeURIComponent(
          lookupTitle
        )}&language=${encodeURIComponent(language)}&type=${mediaType}&season=${season_number}&episode=${episode_number}${autoSuffix}`
      } else {
        captionURL = `/api/authenticated/subtitles?name=${encodeURIComponent(
          lookupTitle
        )}&language=${encodeURIComponent(language)}&type=${mediaType}${autoSuffix}`
      }
      updatedCaptions[language] = { ...captionObject, url: buildURL(captionURL) }
    })
    captions = updatedCaptions
  }

  // A capability for the Cast receiver to report this title's position back
  // once the browser is gone. Minted here, on the server, from the session this
  // render already has — a mint endpoint would be one more thing to authorize.
  //
  // It is scoped to one user and one title and expires within the day, because
  // it travels through the Cast channel to a television whose debug overlay and
  // developer console can both read it. A signed-out or unapproved viewer gets
  // null, so their cast plays and records nothing, matching what the web path
  // already does. The `approved !== false` test mirrors isAuthenticatedAndApproved.
  const castPlaybackToken =
    session?.user?.id && session.user.approved !== false && videoURL
      ? mintCastPlaybackToken({
          userId: session.user.id,
          normalizedVideoId: generateNormalizedVideoId(videoURL),
          metadata: {
            mediaType,
            showId: mediaType === 'tv' ? media.showId ?? null : null,
            seasonNumber: mediaType === 'tv' ? season_number ?? null : null,
            episodeNumber: mediaType === 'tv' ? episode_number ?? null : null,
          },
        })
      : null

  return (
    <Suspense fallback={<div>Loading...</div>}>
      <MainVideoPlayer
        videoURL={videoURL}
        castToken={castPlaybackToken}
        poster={poster}
        titleLabel={mediaPlayerTitleLabel}
        title={title}
        captions={captions}
        chaptersURL={chapters}
        thumbnailsURL={thumbnailURL}
        chapterThumbnailURL={chapterThumbnailURL}
        hasCaptions={hasCaptions}
        hasChapters={hasChapters}
        goBack={goBack}
        mediaMetadata={mediaMetadata}
        logo={logo}
        hdrVal={hdr}
        dimsVal={media.dimensions}
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
        clipStartTime={clipStartTime}
        clipEndTime={clipEndTime}
        start={start}
        savedPlaybackTime={savedPlaybackTime}
        mediaId={media.mediaId || null}
        playbackMetadata={{
          mediaType: mediaType,
          mediaId: media._id,
          showId: mediaType === 'tv' ? media.showId : undefined,
          seasonNumber: mediaType === 'tv' ? season_number : undefined,
          episodeNumber: mediaType === 'tv' ? episode_number : undefined,
        }}
        mediaKey={media.mediaId || videoURL}
        castReceiverId={process.env.CHROMECAST_RECEIVER_ID || null}
        isAdmin={isAdmin}
        adminProps={isAdmin ? {
          SubtitleEditor,
          session,
          mediaType,
          mediaTitle,
          originalTitle: lookupTitle,
          season_number,
          episode_number
        } : null}
      />
    </Suspense>
  )
}

export default VideoPlayer
