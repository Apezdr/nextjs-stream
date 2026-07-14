# Playlist request hygiene: session dedup, resolve-once, direct backend TMDB

> **STATUS (2026-07-14): IMPLEMENTED** on `perf/playlist-request-hygiene`
> (commits `243e6d4`, `aad2d83`). Spikes: S1 PASS (deterministic — Next itself
> caches the headers() promise per request via a WeakMap in
> next/dist/server/request/headers.js); S2 PASS (backend accepts Bearer session
> token, the same material the proxy forwards). Bonus fix shipped in `aad2d83`:
> the proxy returned a null body on backend 304s for endpoints outside its old
> shouldCache list (latent since the backend's ETag extension). Build + lint
> pass. Remaining: deploy, then the SigNoz verification below.

> Follow-up to the horizontal-list consolidation + TMDB ETag chain (both live in prod).
> Post-ETag, a playlist poll still spends its time on session lookups, duplicate
> resolution, and self-HTTP routing — not on data transfer. This plan removes those.
> Phase 2 (sync-tick chunking) is intentionally sequenced AFTER this ships.

## Context / evidence (from production traces + code, 2026-07-14)

- A playlist request performs **27 `get-session` lookups** (~2.2s cumulative in the
  dissected trace): 3 at route level + 2 per TMDB self-HTTP call × 12 calls.
  Root cause: `src/lib/cachedAuth.js:10` wraps `getSession` in React `cache()`,
  which **does not memoize in Route Handlers** (verified against React source +
  Next's app-route runtime — the cache dispatcher is only installed by the RSC
  renderer). Every call = a fresh better-auth lookup = 2 Mongo queries.
- External playlist items are resolved **twice per request**: `getUserWatchlist`
  (`src/utils/watchlist/database.js:372`) unconditionally calls `batchResolveMedia`
  and spreads the result into its items; `getMinimalCardDataForPlaylist` (`:2405`)
  then re-resolves the same items from scratch. `watchlist-content/route.js` calls
  the latter **three times** (page/prev/next), so it pays the duplication triple.
- Server-side `batchResolveMedia` reaches TMDB via **self-HTTP to its own proxy**
  (`makeRequest` in `src/utils/tmdb/client.js` → `localhost/api/authenticated/tmdb/…`),
  paying Next routing + auth per item even now that the backend answers 304.
- `ensurePlaylistVisibilityIndexes` (`watchlist/database.js:1767`) and
  `ensureComingSoonIndexes` (`:2060`) are **not memoized** — 6 `createIndexes`
  round trips on every playlist request (3 at start, 3 at end).
  Memoized precedent: `ensureWatchlistIndexes` (same file).

Target: steady-state playlist p95 from ~1–1.5s (post-ETag expectation) to **~300–500ms**,
with the session-memo benefiting every authenticated route, not just playlists.

## Branch

`perf/playlist-request-hygiene`, branched off `perf/horizontal-list-db-consolidation`
(these changes touch the rewritten route). No deploy in scope; stop after verification + commit.

## Spikes first (gate the two risky pieces)

**S1 — `headers()` identity stability.** The global session memo keys a `WeakMap` on the
object returned by `await headers()`. Verify in dev that repeated `headers()` calls within
one Route Handler request return the SAME object (and that two concurrent requests get
different objects). A throwaway probe route logging object identity is enough.
- If stable → proceed with 1a as designed.
- If NOT stable → fall back to explicit threading only (1a-fallback) and drop the memo;
  do NOT key on cookie-string values (cross-request sharing risks stale sessions).

**S2 — backend auth for direct calls.** Read `src/utils/backendAuth.js`
(`getBackendAuthHeaders`) and the backend's `node/middleware/auth.mjs` to confirm the
headers the proxy already forwards are sufficient when sent directly from
`batchResolveMedia`'s context (its `authHeaders` param is threaded from the route request;
confirm it carries the same material, not relying on `makeRequest`'s `next/headers` cookie
fallback from a nested context).
- If sufficient → proceed with 1c.
- If not → 1c falls back to keeping self-HTTP for the resolver (1a's memo still removes
  its per-call session cost); revisit transport later.

## Changes

### 1a. Request-scoped session memo + user threading

**`src/lib/cachedAuth.js`** — memo the session PROMISE per request so concurrent callers
(e.g. the playlist route's `Promise.allSettled`) share one lookup:

```js
import { cache } from 'react'
import { auth } from '@src/lib/auth'
import { headers } from 'next/headers'

const sessionByRequest = new WeakMap()

// React cache() still dedupes within RSC renders; the WeakMap covers Route
// Handlers, where cache() has no dispatcher and is a passthrough.
export const getSession = cache(async () => {
  const h = await headers()
  if (sessionByRequest.has(h)) return sessionByRequest.get(h)
  const sessionPromise = auth.api.getSession({ headers: h })
  sessionByRequest.set(h, sessionPromise)
  return sessionPromise
})
```

Entries are GC'd with the request (WeakMap). A session revoked mid-request stays valid
for that request only — identical to today's single-check semantics. Memoizing the
promise (not the value) also dedupes parallel callers racing before the first resolves.

**Thread the already-authenticated user (belt and suspenders, removes even memo hits):**
- `getPlaylistById(playlistId, { user = null } = {})` — use provided user for the
  ownership/`isGlobalAdminUser` checks (verify `isGlobalAdminUser`'s expected shape —
  `session.user` carries role/approved), fall back to `getSession()` when absent.
  Update callers: `horizontal-list/route.js:276`, `watchlist-content/route.js:288`,
  `watchlist/route.js:914,:982` (all already hold `authResult`).
- `getUserWatchlist` already accepts `userId` — pass `authResult.id` from
  `horizontal-list/route.js` (playlist branch) and `watchlist-content` if missing.

### 1b. Resolve external items once per request

**`getMinimalCardDataForPlaylist(watchlistItems, playlist, includeUnavailable, options)`**
gains `options.itemsArePreResolved = false`. When `true` (passed by both API routes,
whose `watchlistItems` are `getUserWatchlist` output):
- Items with `isExternal === true` are NOT re-sent to `batchResolveMedia`; their card
  entry is built from the fields the enhancement already spread onto the item
  (`title/posterURL/posterBlurhash/backdropURL/backdropBlurhash/overview/releaseDate/
  genres/voteAverage/tmdbMetadata`). **Shape parity is the risk** — map field-by-field
  against the existing external-card branch (`database.js:2560+`) and pin with a unit
  test asserting both construction paths produce identical cards for one fixture.
- Internal items keep the existing minimal-projection `$in` (it fetches `link/type/
  mediaLastModified/blurhash`, which the enhancement does not carry) — one indexed query.
- Default `false` preserves byte-identical behavior for any other caller.

Net: TMDB resolution clusters per playlist request 2 → 1 (and watchlist-content
saves it ×3). Combined with 1c, the remaining cluster gets dramatically cheaper.

### 1c. Direct backend call for server-side TMDB resolution

New server-only module `src/utils/tmdb/backendClient.js`:
`fetchTmdbFromBackend(endpointPath, params, { authHeaders })` — extracts the proxy
route's URL building (`NODE_SERVER_INTERNAL_URL` fallback chain) + header forwarding +
`httpGet(…, shouldCache=true)` (Redis + If-None-Match + 304-served-from-cache, same as
the proxy leg today).
- `getCachedTMDBDetails` (`mediaResolver.js:350`) calls it instead of
  `getComprehensiveDetails`→`makeRequest` self-HTTP. The HTTP proxy route stays for
  browser/RN clients; refactor it to consume the same module so URL/auth logic lives once.
- Result: server-side external resolution = one direct 304 round trip per item
  (~20–50ms, zero sessions, zero Next routing), single parallel cluster.

### 1d. Memoize the index-ensures

`ensurePlaylistVisibilityIndexes` and `ensureComingSoonIndexes` get the same
process-lifetime flag pattern as `ensureWatchlistIndexes` (flag set only on success).
Callers unchanged. Removes 6 `createIndexes` round trips per playlist request.

## Ordered sequence

1. Spikes S1 + S2 (fast, gate the design)
2. 1d (trivial, independent)
3. 1a (memo + threading) — verify session-count drop in dev traces
4. 1b (resolve-once + shape-parity test)
5. 1c (backend client + resolver switch + proxy refactor to shared module)
6. Build + lint + verification; commit in logical units (no AI attribution trailers)

## Verification

- `npm run build`; eslint on touched files.
- Unit: card shape-parity test (1b); memo test if practical (two getSession calls in one
  mocked request context → one auth.api call).
- Dev smoke with a session cookie: playlist request returns identical JSON shape
  (ETag changes are expected only if field order shifts — it must not; assert
  byte-stable against a pre-change capture for internal-only playlists).
- SigNoz after deploy (clean 30-min windows, avoid deploy churn):
  - `get-session` spans per horizontal-list playlist trace: 27 → ≤2
  - `GET /api/authenticated/tmdb/[...endpoint]` server spans per playlist trace: 12 → 0
    (RN app traffic on that route continues — filter by trace parent)
  - playlist p95 vs the ~1–1.5s post-ETag baseline → target ≤500ms
  - `createIndexes` spans on PlaylistVisibility/ComingSoon: 0 after warmup

## Risks

| Risk | Mitigation |
|---|---|
| `headers()` identity not per-request-stable | S1 gates; fallback = threading only |
| Backend auth rejects direct-call headers | S2 gates; fallback = keep self-HTTP for resolver |
| Pre-resolved external card shape drift | Explicit opt-in flag + field-parity unit test |
| `getPlaylistById` permission semantics | user param optional w/ getSession fallback; verify `isGlobalAdminUser` input shape |
| Stale session within a request (memo) | Same semantics as today's single check; entries die with the request |

## Phase 2 — AFTER this ships (per decision 2026-07-14)

Sync-tick burst mitigation: yield-chunk the `collectFieldAvailability` loops
(`[...admin]/route.js:931-953`, `await setImmediate` every ~50 titles), add a duration
log around the full-library `JSON.parse` (`fetchAllServerData.js:151-154`), re-measure
burst minutes in SigNoz, and only then decide on worker-thread offload.

## Out of scope / later

- `watchlist-content` windowed refactor (still fetches page/prev/next fully — same
  pattern horizontal-list had; natural sequel once this ships)
- `/api/status` multi-second responses (own upstream health checks)
- Authenticated smoke-test matrix for the consolidation (standing item, needs a session)
