# Plan: TV Metadata Staleness Hardening (shows / seasons / episodes)

## Executive Summary

The movie sync path was recently hardened against three distinct "frontend shows stale/wrong metadata even though the on-disk `metadata.json` is correct" failure modes. TV (shows + episodes) is exposed to the **same** failure modes — and on the *spent-gate* axis it is exposed *more* than movies were, because TV stamps `syncHash` unconditionally in its entity builders.

This plan ports the movie hardening to TV. It spans **two repos**:

- **Frontend** — `nextjs-stream` (this repo): `src/utils/sync/domain/tv/`
- **Backend** — `nextjs-stream-media-processor` (sibling repo, path `../nextjs-stream-media-processor` / `C:\Users\Adrum\Documents\github\nextjs-stream-media-processor`): `node/sqlite/metadataHashes.mjs`, `node/sqliteDatabase.mjs`, `node/components/media-scanner/domain/tv-scanner.mjs`, `node/app.mjs`

No TV symptom has been *reported* yet — this is preventative. Recommended ordering: **Phase 1 (show-level) first** (fully exposed, highest visibility), **Phase 2 (episode-level) second** (already frozen-hash-protected + has an inline fallback, so lower urgency). Run the **detection pass** (below) first to see if anything is already stuck.

---

## Background: the three failure modes (and the movie precedent)

Metadata flows: media-processor scans → writes `metadata.json` + computes a hash into SQLite `metadata_hashes` → serves `GET /api/metadata-hashes/{movies,tv}` (the gate hash) and the `metadata.json` file (the content) → webhook triggers a frontend sync → frontend compares the incoming hash vs the stored hash, and if different fetches the `metadata.json` and writes it to MongoDB.

1. **Frozen hash** — the upstream hash does not change when only `metadata.json` *content* changes (e.g. a tmdb_id edit with unchanged images). The frontend's stored hash keeps matching → it skips forever.
2. **Stale fetch** — the frontend fetches `metadata.json` via `fetchMetadataMultiServer` ([`src/utils/admin_utils.js`](src/utils/admin_utils.js)), keyed by **URL**, with a 1h Redis cache + conditional-304 path. If the URL has no content-version token, a content change is served stale from cache.
3. **Spent gate** — the stored gate hash (`syncHash`) advances even though the metadata wasn't actually refreshed (asset-only change, stale fetch, or failed fetch). Once it matches, the early-skip fires forever and the entity is locked on stale metadata.

### What was already done for movies (use as the implementation template)

- **Frozen hash** — backend: `generateMovieHashes` folds `metadata` content into the hash (`node/sqlite/metadataHashes.mjs`, the `metadata: movie.metadata` field).
- **Stale fetch** — backend: `urls.metadata` is cache-busted with `directory_hash` via `buildImageUrl` in `getMovies` / `getMovieById` / `getMovieByName` (`node/sqliteDatabase.mjs`). `directory_hash` moves on any dir change incl. a `metadata.json` rewrite, so the URL changes → frontend cache busts → fresh fetch.
- **Spent gate** — frontend: [`MovieMetadataStrategy.ts`](src/utils/sync/domain/movies/strategies/MovieMetadataStrategy.ts) preserves existing metadata + returns `SyncStatus.Failed` on a failed fetch (no `_metadataHash` stamp); [`MovieSyncService.ts`](src/utils/sync/domain/movies/MovieSyncService.ts) stamps `syncHash` only when no metadata op reported `Failed`.

---

## Verified TV exposure matrix

| Level | Frozen hash | Stale fetch | Spent gate |
|---|---|---|---|
| **Show** | ❌ exposed — show hash uses `metadata_path` (a path string), not content | ❌ exposed — `metadata_path` URL not cache-busted | ❌ exposed — `syncHash` stamped **unconditionally** |
| **Episode** | ✅ protected — episode hash already includes `metadata` content | ❌ exposed — episode metadata URL not cache-busted (mitigated by an inline fallback) | ❌ exposed — `syncHash` stamped **unconditionally** |
| **Season** | ✅ n/a — sourced inline from the parent show's `metadata.seasons[]` | ✅ protected — inline, no fetch | ✅ protected — no separate hash stamp |

### Evidence

Backend (`nextjs-stream-media-processor`):
- Show hash uses path, not content — `node/sqlite/metadataHashes.mjs` `generateTVShowHashes`, `showHashableData = { name, metadata_path, poster, logo, backdrop, seasonKeys }` (~L451-458).
- Episode hash includes content — same file, `episodeHashableData` includes `metadata: episodeData.metadata` (~L496-507).
- Season hash — `{ seasonNumber, season_poster, episodeKeys }` (~L474-478), no metadata.
- Show metadata URL not cache-busted — `node/components/media-scanner/domain/tv-scanner.mjs:221` builds `${prefixPath}/tv/${show}/metadata.json` (no `?hash=`); served raw via `node/app.mjs:755` (`metadata: show.metadata_path`).
- Episode metadata URL not cache-busted — `node/components/media-scanner/domain/tv-scanner.mjs:341`.

Frontend (this repo):
- Show fetch via URL — [`src/utils/sync/domain/tv/TVShowSyncService.ts`](src/utils/sync/domain/tv/TVShowSyncService.ts) ~L225-244 (`fetchMetadataMultiServer(..., fileData.metadata, 'file', 'tv', ...)`).
- Show skip gate — same file ~L64-93 (`cached.syncHash === incoming.hash` + optional `contentHash` + episode-count check).
- Show stamp (unconditional) — same file ~L350-357 (`if (incomingShowHash) entity.syncHash = incomingShowHash`).
- Episode fetch via URL + inline fallback — [`src/utils/sync/domain/tv/EpisodeSyncService.ts`](src/utils/sync/domain/tv/EpisodeSyncService.ts) ~L347-390.
- Episode skip gate — same file ~L103-112 (`incomingEpHash === existing.syncHash`).
- Episode stamp (unconditional, before fetch) — same file ~L116-117 (`if (incomingEpHash) (merged).syncHash = incomingEpHash`).
- Season inline source — [`src/utils/sync/domain/tv/SeasonSyncService.ts`](src/utils/sync/domain/tv/SeasonSyncService.ts) ~L175-206.

---

## Phase 0 — Detection pass (do first, read-only)

Mirror the movie reconciliation to see whether any TV is *already* stuck before investing in code. Compare the frontend's stored id against the on-disk metadata.

- **Shows**: for each `FlatTVShows` doc, compare `metadata.id` against the on-disk `N:\html\tv\<originalTitle>\metadata.json` `id`.
- **Episodes**: for each `FlatEpisodes` doc, compare its `metadata.id` / episode identity against the parent show's on-disk `metadata.seasons[].episodes[]`.

Tools: MongoDB MCP (DB `Media`, collections `FlatTVShows`, `FlatEpisodes`, `FlatSeasons`); on-disk media at `/var/www/html` ↔ `N:\html`. Report divergences; if found, the same `$unset syncHash + metadataHash` reset unsticks them once the code fixes are deployed.

---

## Phase 1 — Show-level hardening

### 1A. Frozen hash (backend)
File: `node/sqlite/metadataHashes.mjs`, `generateTVShowHashes`.
Add show metadata **content** to the show hash, mirroring the movie fix:
```js
const showHashableData = {
  name: show.name,
  metadata: show.metadata,        // ← add: fold content in (was metadata_path only)
  metadata_path: show.metadata_path,
  poster: show.poster,
  logo: show.logo,
  backdrop: show.backdrop,
  seasonKeys: Object.keys(show.seasons)
};
```
**Verify first:** confirm the `show` object passed to `generateTVShowHashes` carries parsed metadata *content* in `show.metadata` (it does in `getTVShows`), not just the path. If the hashing call site passes a row without parsed metadata, parse/attach it there.

### 1B. Stale fetch (backend)
File: `node/sqliteDatabase.mjs`, `getTVShows` (and `getTVShowById` / `getTVShowByName` for parity).
Cache-bust the served show metadata URL with `directory_hash`, mirroring movies. The `/media/tv` endpoint serves `show.metadata_path` (`node/app.mjs:755`), so transform it where the show object is built:
```js
// tv_shows row has directory_hash even though the current return object omits it
metadata_path: buildImageUrl(show.metadata_path, show.directory_hash),
```
(`buildImageUrl` already lives in `node/sqliteDatabase.mjs`; it appends `?hash=<token>` and is a no-op when either arg is falsy.)

### 1C. Spent gate (frontend)
File: [`src/utils/sync/domain/tv/TVShowSyncService.ts`](src/utils/sync/domain/tv/TVShowSyncService.ts) (~L225-244 fetch, ~L350-357 stamp).
Make the `syncHash` stamp conditional on a **confirmed** show-metadata fetch:
- Track a `metadataFetchSucceeded` flag set true only when `fetchMetadataMultiServer` returned usable metadata (`showMetadata && !showMetadata.error`), false in the `catch`/`null`/`error` branches.
- Only stamp `entity.syncHash = incomingShowHash` when `metadataFetchSucceeded` (or when the show-level skip legitimately fired because the hash already matched). Leave it unstamped on fetch failure so the next sync retries.
- Keep `contentHash` stamping **unconditional** — it tracks video-file changes, not metadata, and isn't the metadata gate.
- Mirror the movie data-loss fix: on fetch failure, preserve existing `entity.metadata` (already the behavior at ~L239-241) — just ensure the gate isn't advanced alongside it.

---

## Phase 2 — Episode-level hardening

### 2A. Stale fetch (backend) — more involved
File: `node/components/media-scanner/domain/tv-scanner.mjs:341` (episode metadata URL is baked into the seasons JSON at scan time).
Append a content-version token to each episode's metadata URL. Options:
- **Scan-time (preferred):** append the episode's content hash (or the show `directory_hash`) when building `episodeData.metadata`, so the stored seasons JSON already carries `?hash=`.
- **Serve-time:** in `getTVShows`, walk `seasons[].episodes[]` and rewrite each `metadata` URL with a token. Avoids a rescan to populate, but adds per-request work.

### 2B. Spent gate (frontend)
File: [`src/utils/sync/domain/tv/EpisodeSyncService.ts`](src/utils/sync/domain/tv/EpisodeSyncService.ts) (~L103-117 skip+stamp, ~L347-390 fetch+fallback).
- Move/condition the `(merged).syncHash = incomingEpHash` stamp so it only advances when the episode metadata was **confirmed fetched fresh** — not when the inline parent fallback was used and not on fetch failure. (The inline fallback is fine for *display*, but it must not stamp the gate, or a stale parent would lock the episode.)

---

## Season-level — no action required

Seasons source metadata inline from the parent show (`SeasonSyncService` ~L175-206) and stamp no separate gate hash. They are corrected automatically when the parent show's metadata is corrected (Phase 1). Documented here for completeness.

---

## Testing & rollout

1. **Backend**: `node --check` the edited `.mjs` files; deploy the media-processor image (rebuild → redeploy container on 192.168.1.39).
2. **Frontend**: `npx tsc --noEmit` (must stay at 0 errors); deploy `nextjs-stream`.
3. **Functional validation**: pick a test show, change its `tmdb_id` in `tmdb.config`, let the scanner regenerate, confirm `FlatTVShows.metadata.id` updates on the next sync (and the show page reflects it after the ~2-min `cacheLife('mediaLists')` render cache).
4. **Reconciliation**: for any shows/episodes found divergent in Phase 0 (or after deploy), `$unset syncHash` + `metadataHash` on the affected `FlatTVShows` / `FlatEpisodes` docs so the next sync re-pulls fresh.

## Cross-repo coordination

- 1A, 1B, 2A are **backend** (media-processor) — deploy that image.
- 1C, 2B are **frontend** (this repo) — deploy `nextjs-stream`.
- Deploy backend first (so the gate hash moves on content changes and URLs are cache-busted) before relying on the frontend re-fetch behavior.

## References

- Movie precedent + cross-repo chain: see the media-processor memory `project_metadata_propagation_chain.md`, and the movie implementations in `MovieMetadataStrategy.ts` / `MovieSyncService.ts` (this repo) and `generateMovieHashes` / `getMovies` (media-processor).
- Sync architecture overview: [`SYNC_ARCHITECTURE_MIGRATION.md`](../SYNC_ARCHITECTURE_MIGRATION.md).
