# Playback Presence — React Native Integration Guide

Companion to [media-activity-presence.md](./media-activity-presence.md) (the server-side design) and [media-activity-api.md](./media-activity-api.md) (the read-side API). This is for the existing production React Native app's team: full context on the feature, the exact contract to add, and a scoped implementation plan.

**Confirmed context that shapes everything below:** the published RN app (Google Play `com.anonymous.nextjsstreamtvmobile`, Amazon Appstore) belongs to this team already, is host-agnostic (a user can point it at any self-hosted instance of this site, not one fixed production URL), and already sends watch-history data via the same server contract this doc extends. **This is not a "build a new client" task — it's "add two small things to a client that already works."**

## 1. What this feature is, and why

The server needs to know "is someone actually watching this right now," separate from durable resume-position tracking, for a live-activity widget. The first version derived this purely from `WatchHistory` (the resume-position store), which caused a real bug: a user who paused and closed the app could show as "watching" for up to an hour, because the only paused-state signal was a single fire-and-forget heartbeat with no way to tell "still here" from "gone."

The fix: a new, ephemeral, TTL-backed collection (`Media.PlaybackPresence`), separate from `WatchHistory`, that every client heartbeats into. The web client already does this. This doc covers what the RN app needs to add to do the same.

## 2. What already works — no changes needed here

Since the RN app already authenticates and already sends watch-history data, it already has all of the following working, and none of it needs to change:

- **Auth.** This server runs better-auth (`src/lib/auth.ts` — not NextAuth, despite stale wording in `CLAUDE.md`) with a `bearer()` plugin and a full RFC 8628 device-authorization flow (`deviceAuthorization()` plugin: `/api/auth/device/code` → `/api/auth/device/token` → `Authorization: Bearer <token>` on everything else). The app's "Login with QR code" flow is this exact mechanism. Whatever token it already stores and sends for watch-history calls authenticates the two presence calls below identically — same header, same validation path (`isAuthenticatedAndApproved()` in `src/utils/routeAuth.js`, used by every authenticated route including these).
- **Host-agnostic operation.** Nothing server-side assumes a single fixed host. The device-flow's `verification_uri` is built relative to whichever host issued the request (`ctx.context.baseURL`, i.e. that deployment's own `BETTER_AUTH_URL`), and `trustedOrigins` — the one place a host gets hardcoded per-deployment — only governs browser CORS preflight, which doesn't apply to a native app's direct HTTP calls. Confirmed by reading `src/lib/auth.ts`'s `trustedOrigins` config: it's built from that instance's own env vars, not shared/global. Pointing the app at a different self-hosted instance for presence works exactly the same as it already does for watch history.
- **Device/platform identification.** The server reads the standard `User-Agent` header off the same request and classifies it (`src/utils/deviceDetection.js`) — there's no separate device-type field to send. Whatever the RN app's current watch-history calls already look like from a device-classification standpoint (correct or not) will be identical for presence, since it's the exact same header on the exact same endpoint. If device type already shows correctly wherever it's surfaced today, there's nothing new to do here.

## 3. What to add

Two things, layered onto the existing watch-history call pattern:

### A. A `sessionId` on every existing playback-heartbeat call

`POST /api/authenticated/sync/updatePlayback` — the endpoint the app already calls for watch-history tracking — accepts one new, additive field:

```json
{ "videoId": "string", "playbackTime": 0, "mediaMetadata": {...}, "isPaused": false, "sessionId": "uuid" }
```

Everything except `sessionId` is exactly what's presumably already being sent. `sessionId` is a client-generated UUID, **one per player session** (generated once when playback starts, reused for every heartbeat and the end-of-session call below, not regenerated per request).

**This field is silently optional at the API level** — if it's omitted, the call still succeeds and `WatchHistory` still updates normally, but the presence write is skipped entirely with no error and no signal that anything was skipped. This is the one easy way to ship this feature and have it silently do nothing: forgetting to add `sessionId` means watch history keeps working exactly as before, and RN sessions simply never appear in the live-activity view, with nothing in the response to indicate why.

One other field-level detail worth double-checking against whatever's already implemented: `isPaused` is checked with strict equality (`=== true`) server-side — only a literal JSON boolean `true` registers as paused; anything else (missing, `null`, a truthy-but-non-boolean value) is treated as playing.

### B. A paused-state heartbeat, if one doesn't already exist

This is very likely genuinely new work, not just a field addition — it's the actual bug this whole feature fixes, and if the RN app's existing watch-history tracking has the same shape as the web client's *original* design, it probably only sends a heartbeat on state *transitions* (play→pause, pause→play), not a repeating signal while paused. That's exactly what caused the original staleness bug on web.

The server's read-side freshness windows (`src/utils/mediaActivity.js`) are two fixed values, tuned to two different heartbeat cadences:
- **15s** (default, caller-tunable up to 300s) for playing sessions — assumes a roughly-continuous heartbeat while actively playing (the web client throttles to ~1s).
- **360s, fixed** for paused sessions — calibrated as 2x the web client's 3-minute paused-ping interval (tolerating one missed ping).

**Match the paused cadence (~3 minutes) or coordinate a change to the 360s server constant together** — a much sparser paused heartbeat will cause sessions to flicker out of "active" between pings; a much tighter one wastes battery/data for no benefit (this exact tradeoff was already litigated for the web client — see `media-activity-presence.md` for the reasoning if useful context). Only ping while paused *and* the app is foregrounded — there's no need to keep pinging once backgrounded, since that's what the next endpoint is for.

### C. An explicit "stopped watching" signal

New endpoint, not yet part of the existing contract:

```
POST /api/authenticated/sync/presence/end
{ "sessionId": "uuid" }
```

Returns `200 { message: "Presence session ended" }` unconditionally (safe to call defensively/idempotently — it's a plain `deleteOne`, no "not found" error if the session's already gone) or `400 { error: "Missing or invalid sessionId" }` if `sessionId` is missing/non-string.

Fire this from whatever lifecycle hook already exists for "player closed" / "user navigated away" (the deterministic, preferred trigger), plus on the app backgrounding (`AppState` → `background`/`inactive`) as a backstop for the app being killed without a clean teardown. Without this call, a paused-and-abandoned session still cleans up on its own via the 360s window and a 600s TTL backstop — but this call is what makes the widget update within seconds instead of minutes for the common case (user actually stops watching), so it's worth adding even though it's not strictly required for correctness.

If your player treats switching to a new episode/video as ending one session and starting another (rather than continuing the same `sessionId` across the switch), call `presence/end` for the outgoing session as part of that switch too, for the same "update within seconds, not minutes" reason. **If you do this, read the footgun below before wiring it up** — it's the one place this pattern actually bites.

### D. One footgun to avoid: never send a heartbeat carrying a `sessionId` you've just ended

`presence/end` deletes the presence document. `upsertPresenceHeartbeat` (the function behind `updatePlayback`'s presence write) is an unconditional upsert keyed only on `{userId, sessionId}` — it has zero awareness of a prior `presence/end` call for that same id. The two operations don't coordinate; whichever one reaches the server last simply wins.

This matters specifically if you ever send a "final position" update for the session you're tearing down — e.g. on episode switch, saving the outgoing episode's last watched position to `WatchHistory` before starting the next one. **If that final update still carries the outgoing `sessionId`, it resurrects the presence document you just explicitly ended.** It then just sits there until the normal 360s/15s window and 600s TTL age it out — silently defeating the entire reason for calling `presence/end` early, with no error or signal that anything went wrong.

**Fix: omit `sessionId` entirely from any `updatePlayback` call whose purpose is recording a final position for a session that's simultaneously ending.** `sessionId` is optional at the API level specifically so you can do this safely — a request without it still updates `WatchHistory` normally, it just skips the presence write for that one call, which is exactly the outcome you want. Don't try to fix this by only reordering the two calls (end-then-update or update-then-end) — that still depends on strict request-ordering discipline that two independent HTTP requests don't actually guarantee (retries, network delay, etc. can still land out of order). Dropping the field is the only fix that's correct regardless of ordering.

## 4. What you don't need to build

Given the confirmed context above, most of what would normally be "new client work" doesn't apply here:

- No new auth flow, no new token storage, no client_id decisions — reuse exactly what's already working for watch history.
- No host-configuration changes — presence calls go to the same host, with the same token, as every other call the app already makes.
- No new User-Agent/device-detection work — same header, same endpoint, same server-side classification as today.
- No new error-handling surface for presence itself — a presence-layer failure never affects `updatePlayback`'s response (`WatchHistory` succeeds/fails independently of the presence write, which is caught and logged server-side only).

## 5. Suggested implementation plan

1. Add `sessionId` generation (once per player session, e.g. on player mount/playback start) and thread it through every existing `updatePlayback` call.
2. Check whether a paused-state repeating heartbeat already exists in the current implementation. If not, add one on a ~3-minute interval, active only while paused and foregrounded, calling the same `updatePlayback` endpoint with `isPaused: true`.
3. Add the `presence/end` call to existing player-teardown logic, plus an `AppState` background listener as a backstop.
4. Test against `GET /api/media-activity` (JSON) on a real or test host: confirm a session appears within ~15s of playing, survives a pause across a couple of 3-minute ping cycles, and disappears within a few seconds of closing/backgrounding the app.

## 6. Remaining open question

The one thing this doc can't resolve without a look at the current RN implementation: **what interval does the existing watch-history heartbeat already use?** If it's already close to 1s while playing, nothing changes there. If it's sparser (e.g., only sends periodically or only on seek/pause events), the *playing*-session freshness window (15s default) may need the same "is this cadence actually representative of the presence system's assumptions" review that the paused case clearly needs — worth checking both, not just the paused case, before shipping.
