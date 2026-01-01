'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import CardVideoPlayer from '@components/MediaScroll/CardVideoPlayer';
import { classNames } from '@src/utils';
import Loading from '@src/app/loading';
import { usePlaybackCoordinator } from '@src/contexts/PlaybackCoordinatorContext';

/**
 * EpisodeThumbnail - Displays a single episode thumbnail with hover video preview
 */
export default function EpisodeThumbnail({
  episode,
  isCurrentEpisode,
  mediaTitle,
  mediaSeason,
  episodeLink,
  pending
}) {
  const [isHovering, setIsHovering] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [playingVideo, setPlayingVideo] = useState(false);
  const [afterVideo, setAfterVideo] = useState(false);
  
  // Get access to our playback coordinator context
  const { requestPlayback } = usePlaybackCoordinator();
  
  // Use the clipVideoURL that's included in the episode data
  const videoURL = episode.clipVideoURL;
  const hasVideo = !!videoURL;
  
  // Reset video state when episode changes
  useEffect(() => {
    setVideoReady(false);
    setPlayingVideo(false);
    setAfterVideo(false);
  }, [episode._id]);
  
  // Handlers for video player events
  const handleVideoReady = useCallback((player) => {
    setVideoReady(true);
  }, []);
  
  const handleVideoEnd = useCallback((player) => {
    setPlayingVideo(false);
    setAfterVideo(true);
    // Tell the coordinator we're done playing
    requestPlayback('thumbnail', false);
  }, [requestPlayback]);
  
  const handlePlaying = useCallback(() => {
    setPlayingVideo(true);
    // Tell the coordinator we're starting to play
    requestPlayback('thumbnail', true);
  }, [requestPlayback]);
  
  return (
    <Link 
      href={episodeLink}
      prefetch={false}
      className={`flex-shrink-0 relative group rounded-lg overflow-hidden transition-all duration-300 transform ${
        isCurrentEpisode 
          ? 'ring-2 ring-indigo-500 scale-105 z-10' 
          : 'hover:scale-110'
      }`}
      style={{ width: '180px' }}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => {
        setIsHovering(false);
        setPlayingVideo(false);
        setAfterVideo(false);
        setVideoReady(false);
        // Tell the coordinator we're no longer playing
        requestPlayback('thumbnail', false);
      }}
    >
      {/* Thumbnail background with Next.js Image and blurhash */}
      <div className="w-full h-32 bg-gray-800 relative">
        {episode.thumbnail && (
          <Image
            src={episode.thumbnail}
            alt={episode.title || `Episode ${episode.episodeNumber}`}
            fill
            sizes="180px"
            className={classNames(
              "object-cover",
              // Dim the image when video is playing
              playingVideo ? 'opacity-0' : 'opacity-100',
              // Transition effects
              'transition-opacity duration-300'
            )}
            blurDataURL={episode.thumbnailBlurhash ? `data:image/png;base64,${episode.thumbnailBlurhash}` : undefined}
            placeholder={episode.thumbnailBlurhash ? "blur" : "empty"}
            quality={80}
          />
        )}
        
        {/* Video player that appears on hover */}
        {isHovering && hasVideo && (
          <CardVideoPlayer
            videoURL={videoURL}
            height="100%" 
            width="100%"
            onVideoReady={handleVideoReady}
            onVideoEnd={handleVideoEnd}
            onPlaying={handlePlaying}
            shouldPlay={isHovering && videoReady && !afterVideo}
            className={classNames(
              "absolute inset-0 z-20",
              playingVideo ? "opacity-100" : "opacity-0",
              "transition-opacity duration-300"
            )}
            muted={false}
          />
        )}
        
        {/* Gradient overlay for text readability */}
        <div className={`absolute inset-0 ${
          isCurrentEpisode 
            ? 'bg-gradient-to-t from-indigo-900 to-transparent opacity-90'
            : 'bg-gradient-to-t from-gray-900 to-transparent opacity-70 group-hover:opacity-90'
        }`}>
        </div>
        
        {/* Episode number badge */}
        <div className="absolute top-2 left-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded z-30">
          EP {episode.episodeNumber}
        </div>
        
        {/* HDR badge */}
        {episode.hdr && (
          <div className="absolute top-2 right-2 bg-yellow-500 text-black text-xs font-bold px-2 py-1 rounded z-30">
            HDR
          </div>
        )}
        
        {/* Now playing indicator */}
        {isCurrentEpisode && (
          <div className="absolute right-2 bottom-2 bg-indigo-600 text-white text-xs px-2 py-1 rounded-full z-30">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 inline mr-1" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
            </svg>
            Playing
          </div>
        )}
      </div>
      
      {/* Episode info */}
      <div className="p-2 text-center bg-gray-800">
        {pending ? (
          <Loading fullscreenClasses={false} />
        ) : (
          <div className="text-sm font-medium text-white truncate">
            {episode.title || `Episode ${episode.episodeNumber}`}
          </div>
        )}
        {episode.duration && (
          <div className="text-xs text-gray-400">
            {Math.floor(episode.duration / 60000)}m
          </div>
        )}
      </div>
    </Link>
  );
}
