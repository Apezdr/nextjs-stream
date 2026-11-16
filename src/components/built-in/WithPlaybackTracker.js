'use client';

import { useEffect, useRef, useState } from 'react';
import { Player } from '@components/MediaPlayer/videojs';
import usePlaybackReady from '@components/MediaPlayer/usePlaybackReady';
import throttle from 'lodash/throttle';
import { usePathname } from 'next/navigation';
import { playbackWriteHeaders } from '@src/lib/playbackUser';
import { playbackStore } from '@components/WatchProgress/playbackStore';

// Presence ping cadence while paused and foregrounded. Coarser than the 1s
// playing heartbeat on purpose — see plans/media-activity-presence.md.
const PAUSED_HEARTBEAT_INTERVAL_MS = 3 * 60 * 1000;

const PRESENCE_END_URL = '/api/authenticated/sync/presence/end';

// Never persist a position this close to the start. A resume point in the
// first seconds is worthless, and a spurious ~0 — e.g. the Cast provider
// forcing the element to 0 on disconnect, see CastResumeGuard — otherwise
// overwrites a real resume point in Mongo within ~250ms, unrecoverably. The only behaviour lost is "restarted a title and left again
// within two seconds".
const MIN_PERSISTED_POSITION_S = 2;

function generateSessionId() {
  // crypto.randomUUID requires a secure context; this app can run over
  // plain HTTP on a LAN, so fall back rather than ever leaving this null.
  // getRandomValues works in insecure contexts too, so every browser path
  // gets a cryptographically random id.
  if (typeof crypto !== 'undefined') {
    if (typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    if (typeof crypto.getRandomValues === 'function') {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
  }
  // Only reachable outside a browser (SSR prerender); the ref re-initializes
  // on the client, so this value is never sent anywhere.
  return `ssr-${Date.now()}`;
}

export default function WithPlayBackTracker({
  videoURL,
  mediaMetadata = null,
  // Where this mount starts, resolved once by MainVideoPlayer (a deep link,
  // else the server's row). 0 is an explicit restart; null means "from the top".
  resumeAt = null,
  // True when hls.js was handed `resumeAt` as startPosition and will land the
  // element there itself once the first fragment at that point is buffered.
  // The restore below must then NOT seek: a cold seek on a fresh engine is
  // exactly what held Chrome at readyState 2 for 14-24 s (hlsPlaybackConfig).
  // False for a raw file, which has no engine: the seek is issued here, once,
  // at HAVE_METADATA.
  engineOwnsResume = false,
  // True when the page was opened with a `?start=` deep link; the address
  // bar is cleaned up once the position has been applied.
  clearStartParam = false,
  // The title's two identities, from the server render: the durable id
  // ('mid:…', when the catalog resolved one) and the hash of the URL being
  // played. The progress surfaces of this browser find the title by them
  // (playbackStore.js); the saves themselves still name the raw videoURL.
  mediaId = null,
  normalizedVideoId = null,
  // True while a Cast receiver is playing THIS title and the transport bridge
  // is mirroring it. The position on screen then belongs to the television.
  castAdopted = false,
  // The user this page was rendered for. Every write names them, and the
  // server refuses one whose session is someone else's by the time it goes:
  // a "View as" Stop, or a sign-in in another tab (src/lib/playbackUser.ts).
  userId = null,
  // Told each position this mount reaches (null when a receiver takes the
  // title over): the page keeps the last one for as long as it lives, to
  // start from if it is shown again and the server cannot be asked
  // (MainVideoPlayer).
  onPosition = null
}) {
  const store = Player.usePlayer();
  // Not the store's `canPlay` (readyState 4, sampled on four events). Against
  // the JIT origin that sample can simply never land, and then the saved
  // position is never applied and no progress is ever written. These are read
  // off the raw element on a wider event set — see playbackReadiness.js — and
  // are already false while `castAdopted`; the explicit guards below stay
  // regardless, as the second line rather than the only one.
  const { canSeek, canTrack } = usePlaybackReady(store, { castAdopted });
  const paused = Player.usePlayer((s) => s.paused);
  const [, setLastTimeSent] = useState(0);
  const isFetchingRef = useRef(false);
  const pausedRef = useRef(false);
  const updatePlaybackWorkerRef = useRef(null);
  // Set once the resume position has been applied (or found unnecessary).
  // Every write below waits for it: a heartbeat that lands between mount and
  // the resume seek reports the player booting, not a viewing position.
  const hasAppliedStartRef = useRef(false);
  const localIpRef = useRef(null);
  const latestRef = useRef({ store: null, videoURL: null, mediaMetadata: null, castAdopted: false, userId: null, mediaId: null, normalizedVideoId: null, onPosition: null });
  const sessionIdRef = useRef(null);
  if (sessionIdRef.current === null) {
    sessionIdRef.current = generateSessionId();
  }
  // The last position this mount told the positions store it is at, while it
  // counts as playing there; null before the first and after it said it stopped.
  const liveRef = useRef(null);

  // What this tab is playing, for every progress surface of this browser: the
  // store shows it in this tab and tells the other tabs (every 5 s at most,
  // at once on pause, unpause and seek). Display only: nothing resumes from
  // it, and nothing is written to browser storage.
  const reportLive = (playbackTime) => {
    const { userId: user, mediaId: mid, normalizedVideoId: nid, onPosition: remember } = latestRef.current;
    liveRef.current = { playbackTime };
    remember?.(playbackTime);
    playbackStore.reportPosition({
      userId: user,
      mediaId: mid,
      normalizedVideoId: nid,
      playbackTime,
      paused: pausedRef.current,
      sessionId: sessionIdRef.current,
    });
  };

  // This mount stopped being what plays the title here: unmount, the page
  // leaving, a cast taking it over. The store keeps the last position on show
  // until the server's row has it. A no-op when it never played.
  const endLive = (finalTime, sessionId = sessionIdRef.current) => {
    if (!liveRef.current) return;
    const playbackTime = Number.isFinite(finalTime) ? finalTime : liveRef.current.playbackTime;
    liveRef.current = null;
    const { userId: user, mediaId: mid, normalizedVideoId: nid } = latestRef.current;
    playbackStore.reportEnded({ userId: user, mediaId: mid, normalizedVideoId: nid, playbackTime, sessionId });
  };

  const pathname = usePathname();

  // Apply the resume position when the player is ready.
  useEffect(() => {
    if (!store) return;
    if (hasAppliedStartRef.current) return;

    // While the television owns this title, the saved position must not be
    // applied — seeking here would seek the RECEIVER, dragging the TV back to
    // whatever this page last recorded.
    //
    // Burning the one-shot rather than merely returning is the load-bearing
    // part. Readiness is held false for the whole adopted session (the hook
    // folds `castAdopted` in, and the bridge caps the host's readyState
    // besides), so this effect never gets to run and the flag would stay
    // unset; then at session end readiness rises, this fires for the first
    // time, and overwrites the position just handed over from the receiver
    // with a stale one from render time. That is exactly what made a stopped
    // cast resume in the wrong place while the server's watch history had the
    // right one all along.
    if (castAdopted) {
      hasAppliedStartRef.current = true;
      return;
    }

    let urlCleanupTimeout = null;
    const cleanupStartParam = () => {
      if (!clearStartParam) return;
      // The address bar, not the seek: drop `?start=` so a reload or a
      // shared link does not re-apply it.
      urlCleanupTimeout = setTimeout(() => {
        try {
          window.history.replaceState({}, '', pathname);
        } catch (err) {
          console.error('Error replacing URL:', err);
        }
      }, 100);
    };

    // The engine owns the initial seek (startPosition). Burn the one-shot so
    // no cold seek is ever issued from here.
    if (engineOwnsResume) {
      hasAppliedStartRef.current = true;
      cleanupStartParam();
      return () => {
        if (urlCleanupTimeout) clearTimeout(urlCleanupTimeout);
      };
    }

    // Nothing to seek to: from the top (null) or an explicit restart (0).
    if (!Number.isFinite(resumeAt) || resumeAt <= 0) {
      hasAppliedStartRef.current = true;
      cleanupStartParam();
      return () => {
        if (urlCleanupTimeout) clearTimeout(urlCleanupTimeout);
      };
    }

    // A raw file with a saved position. HAVE_METADATA plus a known duration —
    // a seek needs nothing more, and waiting for HAVE_ENOUGH_DATA is what let
    // the JIT origin starve this.
    if (!canSeek) return;

    store.seek(resumeAt);
    hasAppliedStartRef.current = true;
    cleanupStartParam();

    return () => {
      if (urlCleanupTimeout) clearTimeout(urlCleanupTimeout);
    };
  }, [store, canSeek, resumeAt, engineOwnsResume, clearStartParam, pathname, castAdopted]);

  // Initialize the web worker with error handling and fallback logic.
  useEffect(() => {
    if (typeof Worker === 'undefined') {
      console.error('Web Workers are not supported in this environment.');
      return;
    }

    let worker;

    try {
      const workerUrl = new URL('./updatePlaybackWorker.js', import.meta.url);
      worker = new Worker(workerUrl, { type: 'module' });
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

  // Subscribe to the player store's current time and throttle updates to the worker.
  useEffect(() => {
    if (!canTrack || !store || !updatePlaybackWorkerRef.current) return;
    // The receiver reports its own position while no sender is connected; a
    // client write here would stamp lastWriter:'client' and lock those reports
    // out for a minute. canTrack is already false while adopted — this is the
    // invariant stated outright rather than inherited.
    if (castAdopted) return;

    const throttledUpdateServer = throttle((currentTime) => {
      // Whether or not a save is in flight: the bars show where this tab is,
      // not what the server last acknowledged.
      reportLive(currentTime);

      // One save in flight at a time; a tick that finds one skips, and the
      // next carries the then-current position.
      if (!isFetchingRef.current) {
        isFetchingRef.current = true;

        // Send the current playback time to the worker.
        updatePlaybackWorkerRef.current.postMessage({
          videoURL: videoURL,
          currentTime: currentTime,
          mediaMetadata: mediaMetadata,
          isPaused: pausedRef.current,
          localIp: localIpRef.current,
          sessionId: sessionIdRef.current,
          headers: playbackWriteHeaders(userId),
        });
      }
    }, 1000); // Throttle to 1 second.

    // The store notifies on every state change (currentTime updates at
    // timeupdate cadence); the 1s throttle gates the write rate as before.
    // Direct state reads throw NO_TARGET before/after the media attaches.
    const unsubscribe = store.subscribe(() => {
      if (!store.target) return;
      // Nothing is a viewing position until the resume seek has been applied.
      if (!hasAppliedStartRef.current) return;
      const currentTime = store.currentTime;
      if (currentTime > MIN_PERSISTED_POSITION_S) throttledUpdateServer(currentTime);
    });

    return () => {
      unsubscribe();
      throttledUpdateServer.cancel();
    };
  }, [store, videoURL, canTrack, mediaMetadata, castAdopted, userId]);

  // Send a heartbeat whenever the paused state changes so the live activity
  // view keeps showing the session (as paused) instead of dropping it.
  useEffect(() => {
    pausedRef.current = paused === true;
    if (!canTrack || !store || !store.target || !updatePlaybackWorkerRef.current) return;
    if (castAdopted) return;
    if (!hasAppliedStartRef.current) return;
    const currentTime = store.currentTime || 0;
    if (currentTime <= MIN_PERSISTED_POSITION_S) return;
    // The other tabs hear a pause or an unpause at once
    reportLive(currentTime);
    updatePlaybackWorkerRef.current.postMessage({
      videoURL,
      currentTime,
      mediaMetadata,
      isPaused: paused === true,
      localIp: localIpRef.current,
      sessionId: sessionIdRef.current,
      headers: playbackWriteHeaders(userId),
    });
  }, [paused, canTrack, store, videoURL, mediaMetadata, castAdopted, userId]);

  // Keep presence alive at a low frequency while paused and foregrounded.
  // The currentTime-driven heartbeat stops when playback pauses.
  useEffect(() => {
    if (!canTrack || !store || !updatePlaybackWorkerRef.current) return;
    if (castAdopted) return;

    const interval = setInterval(() => {
      if (!pausedRef.current) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (!store.target) return;
      // Skip while this page sits hidden in Next's segment cache — a hidden
      // paused player must not keep its presence session alive. (Router
      // context is frozen for cached pages, so visibility is checked on the
      // element itself.)
      // store.target is { media, container }, never an element — reach the
      // real node through the media host.
      const element = store.target?.media?.target;
      if (
        element &&
        typeof element.checkVisibility === 'function' &&
        !element.checkVisibility()
      ) {
        return;
      }
      // A keep-alive carries no position on purpose. The pause flip above
      // already wrote where this tab stopped; re-posting that same number
      // every three minutes is what let an idle paused tab drag the row
      // back over progress made on the TV in the meantime. The server
      // refreshes presence from this and leaves the resume point alone.
      updatePlaybackWorkerRef.current.postMessage({
        videoURL,
        kind: 'keepalive',
        mediaMetadata,
        isPaused: true,
        localIp: localIpRef.current,
        sessionId: sessionIdRef.current,
        headers: playbackWriteHeaders(userId),
      });
    }, PAUSED_HEARTBEAT_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [canTrack, store, videoURL, mediaMetadata, castAdopted, userId]);

  // Latest values for the unload path below, which is bound once per mount,
  // and for what this mount tells the positions store.
  useEffect(() => {
    latestRef.current = { store, videoURL, mediaMetadata, castAdopted, userId, mediaId, normalizedVideoId, onPosition };
  });

  // Once a receiver adopts this title, the television is the viewing session
  // and the cast reports for itself (plans/media-activity-presence.md, "Cast").
  // This tab's own row would otherwise linger as a second playing session
  // until it went stale. A fresh id means a later local resume opens a new
  // row instead of reviving the one ended here.
  useEffect(() => {
    if (!castAdopted) return;
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = generateSessionId();
    // Nor is this tab what plays the title any more: the cast's own session
    // is what the progress surfaces follow from here, and the position this
    // page remembered is not where the television will be
    endLive(null, sessionId);
    latestRef.current.onPosition?.(null);
    try {
      fetch(PRESENCE_END_URL, {
        method: 'POST',
        headers: playbackWriteHeaders(latestRef.current.userId),
        body: JSON.stringify({ sessionId }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Best-effort — the row's own staleAfter is the backstop.
    }
  }, [castAdopted]);

  // Best-effort explicit "stopped watching" signal. keepalive lets the
  // request survive page unload; the server-side presence window is fallback.
  //
  // The final position goes first, as a `final` write with no sessionId (the
  // TV app does the same on exit). The 1 s throttle drops whatever tick was
  // pending when the tab went away, and lodash's trailing call is cancelled
  // in the heartbeat effect's cleanup — without this, the last second of
  // every session was lost while the TV app kept its last 30.
  //
  // Both name the user the page was rendered for. They go out as the page
  // leaves, and a "View as" Stop is exactly that: by then the cookie is the
  // admin's, and the server refuses them rather than land the user's position
  // in the admin's history.
  useEffect(() => {
    let flushed = false;
    // Returns the position it saved, or null when it saved nothing.
    const flushFinal = () => {
      if (flushed) return null;
      const { store: s, videoURL: url, mediaMetadata: meta, castAdopted: adopted, userId: user } = latestRef.current;
      // The television owns the position while adopted; nothing to flush.
      if (adopted || !s || !url) return null;
      // Never flush a position the saved point was not applied to yet: a
      // tab closed before the resume seek landed would write ~0 forward.
      if (!hasAppliedStartRef.current) return null;
      let currentTime = 0;
      try {
        if (!s.target) return null;
        currentTime = s.currentTime || 0;
      } catch {
        return null;
      }
      if (currentTime <= MIN_PERSISTED_POSITION_S) return null;
      flushed = true;
      try {
        fetch('/api/authenticated/sync/updatePlayback', {
          method: 'POST',
          headers: playbackWriteHeaders(user),
          body: JSON.stringify({
            videoId: url,
            playbackTime: currentTime,
            kind: 'final',
            mediaMetadata: meta,
            isPaused: true,
            ...(localIpRef.current ? { localIp: localIpRef.current } : {}),
          }),
          keepalive: true,
        }).catch(() => {});
      } catch {
        // Best-effort — the last throttled heartbeat is the backstop.
      }
      return currentTime;
    };

    const endPresence = () => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      try {
        fetch(PRESENCE_END_URL, {
          method: 'POST',
          headers: playbackWriteHeaders(latestRef.current.userId),
          body: JSON.stringify({ sessionId }),
          keepalive: true,
        }).catch(() => {});
      } catch {
        // Best-effort — the server-side presence window is the backstop.
      }
    };

    // After the final save, the tabs of this browser are told this one
    // stopped: with the position just saved, or the last one it reported when
    // the final save had nothing to read (the media was already detached).
    const leave = () => {
      const finalTime = flushFinal();
      endPresence();
      if (finalTime !== null) latestRef.current.onPosition?.(finalTime);
      endLive(finalTime);
    };

    const handlePageHide = () => {
      leave();
    };
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
      leave();
    };
  }, []);

  return null;
}
