# Playback Presence

`Media.PlaybackPresence` answers one question for every client and every reader: **is this person watching this title right now, and is it playing or paused?** `WatchHistory` stays the durable resume-position store; presence is the short-lived signal beside it.

Revised 2026-11-08: one live-session model replaces the per-reader time windows. The original design (2026-07) is folded in where it still holds.

## Why the revision

- **Readers decided freshness, with windows tuned to one client.** A playing row counted as live for 15 s after its last heartbeat, which assumed the web player's ~1 s cadence. The TV/mobile app writes every 30 s while playing (TV commit `1b9f263`, 2026-09-09, made its cadence really 30 s; before that it was ~11 s). Confirmed in prod on 2026-11-08: a TV row sampled every 2 s passed the window for 15 s after each write, then failed it for the next 15 s. Every playing TV session blinked in and out of "Watching".
- **The rule was copied three times.** The admin overview, the media-activity API (desktop widget) and the transcoder-sessions viewer list each ran their own copy of the window query. The admin overview's tie-break (newest heartbeat wins) flipped a card to "Paused" every 3 minutes whenever a paused device's keep-alive landed while another device was playing.
- **Casting wrote no presence**, so a title playing on a Chromecast always read as "not watching".
- **New feature:** a user sees their own live sessions on media pages (web and TV app) and in the API.

## The model

### One row per viewing session

Keyed `{ userId, sessionId }` (unique index `userId_sessionId_unique`). A user on two devices is two sessions.

```js
{
  userId: ObjectId,
  sessionId: string,          // web and TV app: client UUID per player mount; cast: 'cast:' + the receiver's castSessionId
  videoId: string,            // the URL the client played
  normalizedVideoId: string,  // computed at write time
  mediaId: string,            // server-resolved (resolveMediaIdForNid); never client-sent
  mediaType: 'movie' | 'tv',
  showId: ObjectId,           // episodes only, server-resolved from FlatEpisodes.showId; never client-sent
  seasonNumber, episodeNumber,
  state: 'playing' | 'paused',  // replaces isPaused
  playbackTime: number,       // seconds; written only by heartbeats that carry a position
  positionAt: Date,           // when playbackTime was written
  deviceInfo: { type, userAgent, ... },  // cast rows: { type: 'cast' } only
  ipAddress, localIp,
  lastHeartbeat: Date,
  staleAfter: Date,           // the row's own answer to "is this still live"
}
```

`showId` is resolved on the server because clients disagree: the TV app sends its route id, which is not the catalog id. `mediaId` is already handled this way.

### Live means `staleAfter > now`

The server writes `staleAfter` on every heartbeat from one contract, kept in one module (`src/utils/playbackPresence/contract.js`):

| State | A client must check in at least every | `staleAfter` |
|---|---|---|
| playing | 30 s | now + 60 s |
| paused | 180 s | now + 360 s |

- Readers never compute freshness; they filter on `staleAfter`. A raw query, the desktop app or any future tool gets the same answer without knowing any client's cadence.
- A client may check in more often, never less often. Every writer meets the contract today, so this needs no client change, including the TV builds already installed:

  | Writer | While playing | While paused |
  |---|---|---|
  | Web player (`WithPlaybackTracker`) | ~1 s | 180 s |
  | TV / mobile app (`usePlaybackPresenceTracking`) | 30 s | 180 s |
  | Cast receiver, sender connected or not (`playback-reporter.js`) | 15–20 s | 120–125 s |

- **Drift is logged.** When a heartbeat arrives for a row already past its `staleAfter`, the write logs a warning with the session id, device type, state and gap (`findOneAndUpdate`, `returnDocument: 'before'`). The 30 s change went unnoticed for two months; this would have caught it on the first day.
- Rows written before the deploy have no `staleAfter` and are not live (fail closed). Every active session rewrites its row within one heartbeat.
- The TTL index on `lastHeartbeat` (600 s) stays as garbage collection only. It must stay longer than the longest `staleAfter` (360 s).

Because the expiry lives on the row, a later per-client tightening (a client promising a faster cadence and getting a shorter expiry) is a write-side change only. No reader changes.

### Ending a session

`POST /api/authenticated/sync/presence/end` deletes the row; nothing waits for an expiry.

- **Web:** `pagehide`, the tracker's unmount, and the tab going hidden while paused (unchanged). **New:** when a cast receiver takes over playback, the tracker ends its own row. Today the row is left to age out, and under the 60 s rule it would show as a second playing session.
- **TV app:** every exit path and backgrounding while paused (unchanged).
- **Cast:** see below.

The footgun still applies: a client must never send a heartbeat carrying a `sessionId` it has just ended, or the upsert resurrects the row. A `final` write carries no `sessionId`. See [media-activity-presence-rn-integration.md](./media-activity-presence-rn-integration.md).

**What a user sees.** Pauses and clean stops show on the next read. An unclean end (crash, power loss, lost network) stays live for at most 60 s if it was playing, or 360 s if paused.

### Cast

One cast is one row, and the receiver is its only writer (built 2026-11-09, step 2):

- **The row.** The receiver mints a `castSessionId` per loaded title (`public/receiver/js/playback-reporter.js`). `/api/cast/playback` writes `{ userId: claims.u, sessionId: 'cast:' + castSessionId }` with device `{ type: 'cast' }`, never the receiver's user agent. The `cast:` namespace means a cast token can only ever touch cast rows, never the same user's web or TV-app sessions; an id the receiver could not have minted writes no presence.
- **Sender or not.** The receiver reports while a sender is connected too. The sender's `CastPositionMirror` owns the position then, so those reports carry `presenceOnly: true` and the route writes presence only. The mirror writes no presence: a sender tab in the background has its timers throttled to about once a minute, which is no cadence for a 60 s expiry, and a second person's sender connected to the same cast would write it to their own account. The receiver's token names whose cast it is.
- **Idle reports nothing.** A finished title, a stop or a load in progress sends no ordinary report, so a finished title never reads as playing.
- **Ending.** The final reports (`REQUEST_STOP`, `MEDIA_FINISHED`, `SHUTDOWN`) carry `final: true`; the route saves the position when there is one worth saving and ends the row. A final report with no position is allowed, only to end the row. When another title or person loads over the top, the receiver ends the outgoing row with the outgoing token. A final report gets no rolled token.
- **The previous token never comes back.** A response acts on the receiver's snapshot only while it still holds the token the request carried. Before this, a late token refresh for the previous title could be adopted after a new person's title loaded, recording their viewing against the previous person. And a load is told apart by the token it carried, not the rolled one in use: before, any status change after a roll (11 h into a cast) read as a new load and reverted to the original, expired token.
- **Rate limit.** `/api/cast/playback` is limited per IP, which a household's TVs share. Receivers now report while a sender is connected too (~240 an hour while playing), so the limit went from 600 to 1200 an hour.
- **The web tracker** ends its own row when a receiver adopts its title (step 1).

A receiver loaded before the deploy keeps running the old script until it relaunches: it reports presence only while no sender is connected, and its stop is not marked `final`, so the row expires (at most 60 s) instead of ending.

## One reader, one shape, one tie-break rule

`src/utils/playbackPresence/live.js` is the only code that reads `PlaybackPresence` for liveness.

- `findLiveSessions({ userIds?, mediaIds?, showIds?, normalizedVideoIds? })` (`live.js`) runs one query on `staleAfter > now` and returns ranked `LiveSession`s. An empty filter list matches nothing.
- The shape is pure, in `session.js`: `toLiveSession(row)` and `describeDevice(deviceInfo)`. The rules are in `rules.js`, which imports nothing, so the server's readers and the web's client components apply the same ones: `rankSessions(sessions)` (playing before paused, then the newest `lastHeartbeat`), `isOnTitle` / `sessionsOnTitle` (the title rule), `sessionsOnShow` (the show rule) and `livePosition(session, nowMs)`.
- Titles are matched by `mediaId` when both sides carry one, and by `normalizedVideoId` only when one side has no `mediaId` yet (`attach.js`). Two different `mediaId`s are two titles, whatever the hash says. The `normalizedVideoIds` filter exists only for the transcoder-sessions view, which knows a title by nothing else.

```js
// LiveSession
{
  id,                    // the row id; ObjectId hex, so it sorts by when the session started
  sessionId, userId,
  videoId, normalizedVideoId,
  mediaId, mediaType, showId, seasonNumber, episodeNumber,
  state: 'playing' | 'paused',
  position: number,      // seconds, as of positionAt
  positionAt: string,    // ISO. livePosition(): a playing session's position + (now - positionAt)
  device: { type, label, platform, userAgent },  // label: "Chrome · Desktop", "TV", "Cast"
  ipAddress, localIp,
  lastHeartbeat: string,
  staleAfter: string,
}
```

The admin and widget surfaces show `ipAddress` and `localIp`. The personal API (step 3) leaves them out.

Readers that move onto it:

| Reader today | Becomes |
|---|---|
| Admin overview: `getActivePresenceForUsers` + `attach.js` | `findLiveSessions({ userIds })`; a card with a live session gains `liveSessions` (ranked), and the first one sets the badge and the device icon |
| Media-activity API: `getActiveMediaSessions` (`mediaActivity.js`) | `findLiveSessions()`, re-sorted by row id so the widget's rows never reorder; the `activeWindowSeconds` parameter and response field are removed |
| Transcoder sessions: `lookupViewers` (`transcoderSessions.js`) | `findLiveSessions({ normalizedVideoIds })` |

`DEFAULT_ACTIVE_WINDOW_SECONDS`, `PAUSED_WINDOW_SECONDS`, `getActivePresenceForUsers` and the three `$or` window queries are deleted. Removing `activeWindowSeconds` changes the media-activity API contract ([media-activity-api.md](./media-activity-api.md)). Nothing in this workspace sends the parameter; whether the Rainmeter skin does is for the owner to check later.

## A user's own sessions

Built 2026-11-09 (step 3). One module, `src/utils/playbackPresence/personal.js`, serves both:

- **The shape** is the LiveSession minus `ipAddress`, `localIp`, `userId` and `device.userAgent` (`toOwnSession`); `device` is `{ type, label, platform }`. A "Playing on TV · 41:12" line needs none of those, and under "View as" this is what an admin reads as the user. The admin and widget surfaces keep them.
- **`GET /api/authenticated/presence`** returns `{ sessions, asOf }` for the signed-in user, ranked, `no-store`. `asOf` is the server's clock at the read: a client that moves a playing position on between polls counts from it, not from its own clock. Filters: `mediaId` and/or `normalizedVideoId` (one movie or episode, by the title rule), or `showId` with an optional `season` (a show, or one season; Specials are season 0). A title filter with a show filter, a malformed `showId`, or a `season` without a `showId` is a 400. There is no `userId` parameter: it is the caller's own sessions, and under "View as" the caller is the viewed user (it is a read). A failed read is a 500, never an empty list.
- **`/api/authenticated/media`** gains `watchingNow` whenever it is asked for `includeWatchHistory=true`, beside `watchHistory`, read off the payload's own fields (`watchingNowFor`):
  - a movie, or an episode: sessions on that title;
  - a season: sessions on any of its episodes; on the TV app's season page each episode in `episodes` also carries its own `watchingNow`;
  - a show: sessions on any of its episodes.

  `watchingNow: []` means nothing is live; the field is **absent** when it was not asked for or could not be read. It passes through the TV-device shape (`sanitizeTVData`) and the card shape (`sanitizeCardData`), so the web's hover cards, which ask for watch history, get it too.
- **Season and episode numbers come from the catalog.** The write resolves them from `FlatEpisodes` with `showId` (`resolveMediaIdForNid`), so a show page names the right episode whichever client reported it. The client's numbers stand only when the catalog has none.
- **Web** (built 2026-11-09, step 4; cards added the same day): one client store, `src/components/WatchingNow/ownSessions.js`, asks the unfiltered endpoint once per page, however many surfaces read it, and again every 15 s while one is mounted and the tab is visible. A user has a handful of live sessions at most, so one answer serves every title on the page; each surface picks its own with the rules above. A failed poll reads as nothing live, a 401 or 403 stops the polling, and an answer older than one poll is dropped when a surface mounts after a client navigation. The pages' cached and prefetched shells never carry any of it. The surfaces:
  - **The line** (`WatchingNowLine`), under the meta line on the movie, episode, season and show pages. One line per device, at most three, then "and N more":
    - a movie or an episode: "Playing on TV · 41:12", "Paused on Chrome · Desktop · 12:03";
    - a show: "Playing S2 · E7 on TV · 41:12"; a season: "Playing Episode 7 on TV". The episode noun is the primary button's (`nextUpNoun`), Specials included, and links to the episode page;
    - a cast reads "on a Cast device", a device with no label "on another device"; no position yet, no clock.

    A playing position ticks once a second from `positionAt` by the server's clock (`asOf`).
  - **The card badge** (`LiveBadge`) on the rails' cards: "Playing" or "Paused" at the poster's top left, with the sentence ("Playing S2 · E7 on TV, and 1 more device") as its tooltip and screen-reader text. A movie or episode card matches by the title rule, a show card by its catalog id (any episode). Never on a title outside the library or a trailer stand-in. Its own component, so only the badge re-renders when the sessions change.
  - **The hover popup:** the line, in the popup's light tone, above the resume block; it names a show's episode without a link.

  None of them uses the media payload's `watchingNow`: the pages are cached, the poll is not.
- **TV app media pages:** the same endpoint, with the same words. Handed over as a doc, [TV app: watching now on media pages](https://claude.ai/artifact/RvwReSuGJJFraWYSuv4esP) (2026-11-09), since that repo is read-only from here, and shipped together with the web UI. `watchingNow` on the payload the screen already loads paints the first frame, so opening a screen costs no request. The app caches media payloads for 5 minutes, so while a screen is focused one `/presence` poll every 15 s keeps it live; on the show screen that one poll serves the hero and every episode row. The canonical API contract (`docs/frontend-api-contract.md` in the TV app's repo) gains `watchingNow` and the endpoint through that doc.

## Steps

Each step ships on its own and comes with tests.

1. **Write side and the one reader, in one deploy**, so readers move to `staleAfter` in the same release in which rows gain it.
   - `contract.js`; `upsertPresenceHeartbeat` writes `state`, `staleAfter`, `positionAt` and the server-resolved `showId`; the drift warning; `isRepeatPausedPing` reads `state`.
   - `live.js`, with the three readers moved onto it.
   - The web tracker ends its row when a cast receiver takes over.
   - Update `media-activity-api.md` and the integration doc's windows section.

   This alone fixes the TV blinking and the "Paused" flips on the admin overview, the desktop widget and the transcoder sessions view.
2. **Cast presence** (built 2026-11-09): the receiver writes and ends the cast's row, sender or not; `/api/cast/playback` takes `presenceOnly` and `final`; `DeviceBadge` and `getDeviceTypeLabel` learn `cast`. The original plan had the sender's mirror write the row while connected; dropped for the background-tab throttling and second-sender reasons above.
3. **Personal API** (built 2026-11-09): `GET /api/authenticated/presence` and `watchingNow` on `/api/authenticated/media`; season and episode numbers resolved from the catalog at write time.
4. **Media-page UI on web, plus the TV app hand-off doc** (built 2026-11-09), shipped together. The endpoint gains `asOf`.

## Decisions

- Casting counts as watching (owner, 2026-11-08).
- A user's own sessions appear on media pages on web and in the TV app, and in the API (owner, 2026-11-08).
- One contract for every client rather than windows per client: a client may report faster, never slower.

## Out of scope

- Push or WebSocket presence. There is still no WebSocket infrastructure in this app, and TV platforms suspend background network activity too aggressively for a persistent connection to beat a bounded heartbeat.
- Showing other users' sessions to non-admins.
