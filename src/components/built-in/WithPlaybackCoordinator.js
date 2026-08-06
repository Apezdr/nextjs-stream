'use client';

import { useEffect, useRef, useState } from 'react';
import { Player } from '@components/MediaPlayer/videojs';
import { usePlaybackCoordinator } from '@src/contexts/PlaybackCoordinatorContext';

/**
 * WithPlaybackCoordinator - Client component that coordinates playback between
 * the main media player and thumbnail previews.
 *
 * This component doesn't render anything, but connects the media player
 * to our PlaybackCoordinatorContext.
 */
export default function WithPlaybackCoordinator() {
  const store = Player.usePlayer();
  const paused = Player.usePlayer((s) => s.paused);
  const { activePlayer, wasMainPlayerPaused, setWasMainPlayerPaused } = usePlaybackCoordinator();

  // Track if the user has manually paused the player
  const [manuallyPaused, setManuallyPaused] = useState(false);

  const activePlayerRef = useRef(activePlayer);
  useEffect(() => {
    activePlayerRef.current = activePlayer;
  }, [activePlayer]);

  // Watch for pause/play transitions via the store subscription. A pause only
  // counts as manual when no thumbnail preview is active (the coordinator's
  // own pause sets activePlayer='thumbnail' first).
  useEffect(() => {
    if (!store) return;
    // Direct state reads throw StoreError NO_TARGET before the store attaches
    // to the media element — gate every read on store.target.
    let prevPaused = store.target ? store.paused : undefined;
    const unsubscribe = store.subscribe(() => {
      if (!store.target) return;
      const nowPaused = store.paused;
      if (nowPaused === prevPaused) return;
      prevPaused = nowPaused;
      if (nowPaused) {
        if (activePlayerRef.current !== 'thumbnail') {
          setManuallyPaused(true);
        }
      } else {
        setManuallyPaused(false);
      }
    });
    return unsubscribe;
  }, [store]);

  // Handle playback coordination when active player changes
  useEffect(() => {
    if (!store || !store.target) return;

    if (activePlayer === 'thumbnail') {
      // Store current state before pausing
      setWasMainPlayerPaused(paused);
      if (!paused) {
        store.pause();
      }
    } else if (activePlayer === null) {
      // Only resume if:
      // 1. It wasn't paused before the thumbnail started
      // 2. AND the user hasn't manually paused while we were showing thumbnails
      if (!wasMainPlayerPaused && !manuallyPaused && paused) {
        store.play();
      }
    }
  }, [activePlayer, store, paused, wasMainPlayerPaused, setWasMainPlayerPaused, manuallyPaused]);

  // This component doesn't render anything
  return null;
}
