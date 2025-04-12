'use client';

import { useEffect, useState } from 'react';
import { useMediaPlayer, useMediaRemote, useMediaState } from '@vidstack/react';
import { usePlaybackCoordinator } from '@src/contexts/PlaybackCoordinatorContext';

/**
 * WithPlaybackCoordinator - Client component that coordinates playback between
 * the main media player and thumbnail previews.
 * 
 * This component doesn't render anything, but connects the media player
 * to our PlaybackCoordinatorContext.
 */
export default function WithPlaybackCoordinator() {
  const player = useMediaPlayer();
  const remote = useMediaRemote();
  const playing = useMediaState('playing');
  const paused = useMediaState('paused');
  const { activePlayer, wasMainPlayerPaused, setWasMainPlayerPaused } = usePlaybackCoordinator();
  
  // Track if the user has manually paused the player
  const [manuallyPaused, setManuallyPaused] = useState(false);
  
  // Watch for manual pause events
  useEffect(() => {
    if (!player) return;
    
    const handlePause = () => {
      // Only consider it a manual pause if no thumbnail is active
      if (activePlayer !== 'thumbnail') {
        setManuallyPaused(true);
      }
    };
    
    const handlePlay = () => {
      // Reset manual pause flag when user plays
      setManuallyPaused(false);
    };
    
    player.addEventListener('pause', handlePause);
    player.addEventListener('play', handlePlay);
    
    return () => {
      player.removeEventListener('pause', handlePause);
      player.removeEventListener('play', handlePlay);
    };
  }, [player, activePlayer]);

  // Handle playback coordination when active player changes
  useEffect(() => {
    if (!player || !remote) return;
    
    if (activePlayer === 'thumbnail') {
      // Store current state before pausing
      setWasMainPlayerPaused(paused);
      if (!paused) {
        remote.pause();
      }
    } else if (activePlayer === null) {
      // Only resume if:
      // 1. It wasn't paused before the thumbnail started
      // 2. AND the user hasn't manually paused while we were showing thumbnails
      if (!wasMainPlayerPaused && !manuallyPaused && paused) {
        remote.play();
      }
    }
  }, [activePlayer, remote, player, paused, wasMainPlayerPaused, setWasMainPlayerPaused, manuallyPaused]);

  // Register the main player when it's playing
  useEffect(() => {
    if (!player) return;
    
    // Only register as the main player when actually playing
    if (playing && activePlayer !== 'thumbnail') {
      // This will unset any other active player
      // But we check it's not a thumbnail to avoid race conditions
      // requestPlayback('main', true);
    }
  }, [playing, player, activePlayer]);

  // This component doesn't render anything
  return null;
}
