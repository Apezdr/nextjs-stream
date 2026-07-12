'use client';

import { useEffect, useRef, useState } from 'react';
import { useMediaPlayer, useMediaRemote, useMediaState } from '@vidstack/react';
import throttle from 'lodash/throttle';
import { useRouter, usePathname } from 'next/navigation';

// Presence ping cadence while paused and foregrounded. Coarser than the 1s
// playing heartbeat on purpose — see plans/media-activity-presence.md.
const PAUSED_HEARTBEAT_INTERVAL_MS = 3 * 60 * 1000;

const PRESENCE_END_URL = '/api/authenticated/sync/presence/end';

function generateSessionId() {
  // crypto.randomUUID requires a secure context; this app can run over
  // plain HTTP on a LAN, so fall back rather than ever leaving this null.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function WithPlayBackTracker({
  videoURL,
  start = null,
  mediaMetadata = null,
  savedPlaybackTime = null
}) {
  const player = useMediaPlayer();
  const canPlay = useMediaState('canPlay');
  const paused = useMediaState('paused');
  const remote = useMediaRemote();
  const [lastTimeSent, setLastTimeSent] = useState(0);
  const isFetchingRef = useRef(false);
  const nextUpdateTimeRef = useRef(null);
  const pausedRef = useRef(false);
  const updatePlaybackWorkerRef = useRef(null);
  const hasAppliedStartRef = useRef(false);
  const localIpRef = useRef(null);
  const sessionIdRef = useRef(null);
  if (sessionIdRef.current === null) {
    sessionIdRef.current = generateSessionId();
  }
  
  // Next.js routing hooks for URL manipulation
  const router = useRouter();
  const pathname = usePathname();

  // Restore saved playback time when the player is ready.
  useEffect(() => {
    if (!canPlay || !remote) return;

    let urlCleanupTimeout = null;

    const restorePlaybackPosition = async () => {
      // Try localStorage first (fastest)
      const savedData = localStorage.getItem(videoURL);
      const savedTime = savedData ? parseFloat(JSON.parse(savedData).playbackTime) : null;

      if (!hasAppliedStartRef.current) {
        // Priority 1: URL parameter (deep links) - highest priority
        if (start !== null && start !== undefined) {
          remote.seek(start);

          // Clean up the URL by removing query parameters
          urlCleanupTimeout = setTimeout(() => {
            try {
              window.history.replaceState({}, '', pathname);
            } catch (err) {
              console.error("Error replacing URL:", err);
            }
          }, 100);
        }
        // Priority 2: Server-provided savedPlaybackTime (passed as prop from server)
        else if (savedPlaybackTime !== null && savedPlaybackTime > 0) {
          remote.seek(savedPlaybackTime);
          // Cache it locally for future use
          localStorage.setItem(videoURL, JSON.stringify({
            playbackTime: savedPlaybackTime,
            lastUpdated: new Date().toISOString()
          }));
        }
        // Priority 3: localStorage (for recently synced videos)
        else if (!isNaN(savedTime) && savedTime !== null) {
          remote.seek(savedTime);
        }
        hasAppliedStartRef.current = true;
      }
    };

    restorePlaybackPosition();

    return () => {
      if (urlCleanupTimeout) clearTimeout(urlCleanupTimeout);
    };
  }, [remote, canPlay, videoURL, start, pathname, savedPlaybackTime]);

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
    const handleWorkerMessage = (event) => {
      const { success, currentTime, error } = event.data;
      if (success) {
        setLastTimeSent(currentTime);
      } else {
        console.error('Worker error:', error);
      }
      isFetchingRef.current = false;
    };
    worker.addEventListener('message', handleWorkerMessage);

    return () => {
      worker.removeEventListener('message', handleWorkerMessage);
      worker.terminate();
    };
  }, []);

  // Best-effort local (LAN) IP discovery via WebRTC host ICE candidates. Modern
  // browsers usually return an mDNS "xxxx.local" hostname instead of a real IP
  // (privacy), in which case we report nothing; where the real IP is exposed we
  // capture it and send it with playback updates as a device-reported localIp.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof RTCPeerConnection === 'undefined') return;

    let pc;
    let cancelled = false;
    const ipv4 = /((?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3})/;
    const ipv6 = /((?:[0-9a-fA-F]{1,4}:){2,}[0-9a-fA-F]{1,4})/;

    try {
      pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel('');
      pc.onicecandidate = (event) => {
        if (cancelled || !event?.candidate?.candidate) return;
        const candidate = event.candidate.candidate;
        if (candidate.includes('.local')) return; // mDNS-obfuscated — unusable
        const match = candidate.match(ipv4) || candidate.match(ipv6);
        const ip = match?.[1];
        if (!ip || ip === '127.0.0.1' || ip === '0.0.0.0') return;
        localIpRef.current = ip;
        cancelled = true;
        try { pc.close(); } catch { /* noop */ }
      };
      pc.createOffer().then((offer) => pc.setLocalDescription(offer)).catch(() => {});
    } catch {
      // WebRTC unavailable — leave localIp null.
    }

    return () => {
      cancelled = true;
      try { pc?.close(); } catch { /* noop */ }
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
          isPaused: pausedRef.current,
          localIp: localIpRef.current,
          sessionId: sessionIdRef.current,
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
  }, [player, videoURL, canPlay, mediaMetadata]);

  // Send a heartbeat whenever the paused state changes so the live activity
  // view keeps showing the session (as paused) instead of dropping it.
  useEffect(() => {
    pausedRef.current = paused === true;
    if (!canPlay || !player || !updatePlaybackWorkerRef.current) return;
    const currentTime = player.state?.currentTime || 0;
    if (currentTime <= 0) return;
    updatePlaybackWorkerRef.current.postMessage({
      videoURL,
      currentTime,
      mediaMetadata,
      isPaused: paused === true,
      localIp: localIpRef.current,
      sessionId: sessionIdRef.current,
    });
  }, [paused, canPlay, player, videoURL, mediaMetadata]);

  // Keep presence alive at a low frequency while paused and foregrounded.
  // The currentTime-driven heartbeat stops when playback pauses.
  useEffect(() => {
    if (!canPlay || !player || !updatePlaybackWorkerRef.current) return;

    const interval = setInterval(() => {
      if (!pausedRef.current) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const currentTime = player.state?.currentTime || 0;
      if (currentTime <= 0) return;
      updatePlaybackWorkerRef.current.postMessage({
        videoURL,
        currentTime,
        mediaMetadata,
        isPaused: true,
        localIp: localIpRef.current,
        sessionId: sessionIdRef.current,
      });
    }, PAUSED_HEARTBEAT_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [canPlay, player, videoURL, mediaMetadata]);

  // Best-effort explicit "stopped watching" signal. keepalive lets the
  // request survive page unload; the server-side presence window is fallback.
  useEffect(() => {
    const endPresence = () => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      try {
        fetch(PRESENCE_END_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
          keepalive: true,
        }).catch(() => {});
      } catch {
        // Best-effort — the server-side presence window is the backstop.
      }
    };

    const handlePageHide = () => endPresence();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && pausedRef.current) {
        endPresence();
      }
    };

    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      endPresence();
    };
  }, []);

  return null;
}
