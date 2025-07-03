'use client';

import { useEffect, useRef, useState } from 'react';
import { useMediaPlayer, useMediaRemote, useMediaState } from '@vidstack/react';
import throttle from 'lodash/throttle';
import { useRouter, usePathname } from 'next/navigation';

export default function WithPlayBackTracker({
  videoURL,
  start = null,
  mediaMetadata = null
}) {
  const player = useMediaPlayer();
  const canPlay = useMediaState('canPlay');
  const remote = useMediaRemote();
  const [lastTimeSent, setLastTimeSent] = useState(0);
  const isFetchingRef = useRef(false);
  const nextUpdateTimeRef = useRef(null);
  const updatePlaybackWorkerRef = useRef(null);
  const hasAppliedStartRef = useRef(false);
  
  // Next.js routing hooks for URL manipulation
  const router = useRouter();
  const pathname = usePathname();

  // Restore saved playback time when the player is ready.
  useEffect(() => {
    if (!canPlay || !remote) return;

    const savedData = localStorage.getItem(videoURL);
    const savedTime = savedData ? parseFloat(JSON.parse(savedData).playbackTime) : null;

    if (!hasAppliedStartRef.current) {
      // Important: Check if start is not null/undefined rather than just truthy check
      // This is critical because start could be 0, which is falsy but valid
      if (start !== null && start !== undefined) {
        remote.seek(start);
        
        // Clean up the URL by removing query parameters
        setTimeout(() => {
          try {
            // Use window.history directly since Next.js router methods might not be reliable
            window.history.replaceState({}, '', pathname);
          } catch (err) {
            console.error("Error replacing URL:", err);
          }
        }, 100);
      } else if (!isNaN(savedTime) && savedTime !== null) {
        remote.seek(savedTime);
      }
      
      hasAppliedStartRef.current = true;
    }
  }, [remote, canPlay, videoURL, start, pathname]);

  // Initialize the web worker with error handling and fallback logic.
  useEffect(() => {
    if (typeof Worker === 'undefined') {
      console.error('Web Workers are not supported in this environment.');
      return;
    }

    let worker;

    try {
      // Option 1: Use the module-relative URL.
      //
      // This works if your bundler (e.g. Next.js with Webpack 5) correctly handles worker files.
      //
      // If you experience sporadic URL issues, you can uncomment Option 2 below.
      const workerUrl = new URL('./updatePlaybackWorker.js', import.meta.url);
      worker = new Worker(workerUrl, { type: 'module' });

      /* Option 2: Use a worker file placed in the public directory.
      
      // First, move updatePlaybackWorker.js to your public/ folder.
      // Then, instantiate the worker with the absolute URL:
      const workerUrl = '/updatePlaybackWorker.js';
      worker = new Worker(workerUrl, { type: 'module' });
      */
    } catch (error) {
      console.error('Failed to instantiate worker:', error);
      return;
    }

    updatePlaybackWorkerRef.current = worker;

    // Listen for messages from the worker.
    worker.addEventListener('message', (event) => {
      const { success, currentTime, error } = event.data;
      if (success) {
        setLastTimeSent(currentTime);
      } else {
        console.error('Worker error:', error);
      }
      isFetchingRef.current = false;
    });

    return () => {
      worker.terminate();
    };
  }, []);

  // Subscribe to the media player's current time and throttle updates to the worker.
  useEffect(() => {
    if (!canPlay || !player || !updatePlaybackWorkerRef.current) return;

    const throttledUpdateServer = throttle((currentTime) => {
      if (!isFetchingRef.current) {
        isFetchingRef.current = true;

        localStorage.setItem(
          videoURL,
          JSON.stringify({
            playbackTime: currentTime,
            lastUpdated: new Date().toISOString(),
          })
        );

        // Send the current playback time to the worker.
        updatePlaybackWorkerRef.current.postMessage({
          videoURL: videoURL,
          currentTime: currentTime,
          mediaMetadata: mediaMetadata,
        });
      } else {
        nextUpdateTimeRef.current = currentTime;
      }
    }, 1000); // Throttle to 1 second.

    // Subscribe to player time updates.
    const unsubscribe = player.subscribe(({ currentTime }) => {
      if (currentTime > 0) throttledUpdateServer(currentTime);
    });

    return () => {
      unsubscribe();
      throttledUpdateServer.cancel();
    };
  }, [player, videoURL, canPlay]);

  return null;
}
