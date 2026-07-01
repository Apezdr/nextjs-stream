# Playback Presence Tracking

Replaces the `WatchHistory`-derived "active sessions" logic behind the [Media Activity API](./media-activity-api.md) with a dedicated, ephemeral presence signal. Fixes two problems with the original design:

1. Paused sessions could show as "active" for up to an hour after a user actually walked away, because the only heartbeat was a single fire-and-forget update on the pause transition itself.
2. The activity API joined `WatchHistory` to `FlatMovies`/`FlatEpisodes` on raw `videoURL` only, instead of this codebase's established `normalizedVideoId` join pattern (see `MovieRepository`/`EpisodeRepository`), risking silent "Unknown Media" fallbacks on URL drift.

`WatchHistory` is unchanged and remains the durable resume-position store. This is purely a new, short-lived signal layered on top.

## New collection: `Media.PlaybackPresence`

One document per player session (not per user or per video — a user watching on two devices at once is two legitimate sessions):

```js
{
  sessionId: string,          // client-generated UUID, one per player mount
  userId: ObjectId,
  videoId: string,            // raw videoURL, same value WatchHistory.videoId stores
  normalizedVideoId: string,  // generateNormalizedVideoId(videoId), computed at write time
  mediaType: 'movie' | 'tv',
  seasonNumber, episodeNumber,
  playbackTime: number,
  isPaused: boolean,
  deviceInfo: { type, userAgent },  // reuses src/utils/deviceDetection.js, same shape as WatchHistory
  lastHeartbeat: Date,
}
```

Indexes:
- `{ userId: 1, sessionId: 1 }` unique — upsert/delete key.
- `{ lastHeartbeat: 1 }` with `expireAfterSeconds: 600` — pure garbage collection backstop for sessions that never send an explicit end signal (crash, force-quit, network loss). Not relied on for correctness: Mongo's TTL monitor sweeps roughly once a minute, so this only bounds worst-case collection growth, not "is this active" freshness.

Indexes are created lazily and idempotently (guarded by a `globalThis` flag, matching the existing `migratePlaybackStatusIfNeeded` pattern) the first time a presence write happens, rather than depending on a separate init/migration script — this codebase has previously shipped indexes that were declared but never actually created because the script that created them was never invoked in production.

## Client signals (web today; same contract for Android/iOS/tvOS/Apple TV/Roku later)

Three distinct triggers, reusing the existing `updatePlayback` heartbeat wherever possible instead of adding new endpoints:

1. **Playing** — unchanged: the existing 1s-throttled `updatePlayback` call (driven by the player's `currentTime` subscription) now also upserts the presence document's `lastHeartbeat` in the same request.
2. **Paused + foregrounded** — new: a fixed `setInterval` (3 minutes), decoupled from the `currentTime` subscription since that stops firing on pause, calls the *same* `updatePlayback` endpoint with `isPaused: true`. Skipped while `document.visibilityState !== 'visible'` — a backgrounded-and-paused session doesn't need to keep pinging, since backgrounding fires the end signal below.
3. **Session end** — new endpoint (`POST /api/authenticated/sync/presence/end`, body `{ sessionId }`), fired via `fetch(..., { keepalive: true })` so the request can outlive page unload:
   - On `pagehide` (tab close, navigation, mobile Safari backgrounding).
   - On the tracker's own unmount (in-app navigation away from the player without a full page reload).
   - Immediately on `visibilitychange` → hidden **while paused** (no legitimate "still consuming media in the background while paused" case exists, unlike the playing case where PiP/background-audio can be legitimate).
   - Deletes the presence document outright — doesn't wait for any window to expire.

This is a best-effort signal, not a guarantee — a hard crash or lost network mid-pause never fires it. The read-side window below is the backstop for that case.

## Read side: `getActiveMediaSessions()`

Replaces the `WatchHistory` query and the old `PAUSED_WINDOW_SECONDS = 3600` special case with a single collection, two windows sized to their respective heartbeat cadences:

```js
const activeSince = new Date(Date.now() - activeWindowSeconds * 1000)   // playing sessions; caller-tunable, default 15s / max 300s, unchanged from today
const pausedSince = new Date(Date.now() - PAUSED_WINDOW_SECONDS * 1000) // paused sessions; fixed at 360s = 2x the 3-minute paused ping, tolerating one missed ping

PlaybackPresence.find({
  $or: [
    { isPaused: { $ne: true }, lastHeartbeat: { $gte: activeSince } },
    { isPaused: true, lastHeartbeat: { $gte: pausedSince } },
  ],
})
```

360s is a 10x tightening from the original 3600s, correctly calibrated to the new paused-ping cadence rather than an arbitrary hour-long allowance — a crashed/abandoned paused session now goes stale in minutes, not up to an hour, while a genuinely-still-open paused session stays visible indefinitely via its own pings.

`getMediaMaps()` now joins `FlatMovies`/`FlatEpisodes` using the established `$or: [{ normalizedVideoId: { $in } }, { videoURL: { $in } }]` union pattern (matching `MovieRepository`/`EpisodeRepository`) instead of `videoURL` alone.

## Out of scope for this change

- Android/iOS/tvOS/Apple TV/Roku clients — this lays down the server contract (`updatePlayback` + `presence/end`, both already generic over `deviceInfo`); wiring each native client to call it is separate, per-platform work.
- WebSocket/push-based presence — considered and rejected for now (see discussion): no existing WS infrastructure in this app (no custom server, no `ws`/`socket.io` dependency), and TV platforms in the roadmap (Roku especially) suspend background network activity aggressively enough that a persistent connection wouldn't meaningfully outperform a bounded heartbeat for this use case.
